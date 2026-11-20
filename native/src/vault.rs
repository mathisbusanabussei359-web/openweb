use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use napi::{
    Error, Status,
    bindgen_prelude::{AsyncTask, Env, Result, Task},
};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use zeroize::{ZeroizeOnDrop, Zeroizing};

const MAGIC: &[u8; 8] = b"OPENWV01";
const SALT_SIZE: usize = 16;
const NONCE_SIZE: usize = 24;
const MAX_FILE_SIZE: u64 = 4 * 1024 * 1024;

fn error(message: &str) -> Error {
    Error::new(Status::GenericFailure, message)
}

fn random<const SIZE: usize>() -> Result<[u8; SIZE]> {
    let mut bytes = [0; SIZE];
    getrandom::fill(&mut bytes).map_err(|_| error("Aléa système indisponible."))?;
    Ok(bytes)
}

fn derive_key(code: &[u8], salt: &[u8; SALT_SIZE]) -> Result<Zeroizing<[u8; 32]>> {
    let params = Params::new(64 * 1024, 3, 1, Some(32))
        .map_err(|_| error("Paramètres de chiffrement invalides."))?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(code, salt, key.as_mut())
        .map_err(|_| error("La dérivation de clé a échoué."))?;
    Ok(key)
}

#[derive(Deserialize, Serialize, ZeroizeOnDrop)]
struct Entry {
    id: String,
    origin: String,
    username: String,
    password: String,
}

#[napi(object)]
pub struct EntrySummary {
    pub id: String,
    pub origin: String,
    pub username: String,
}

#[napi(object)]
pub struct Login {
    pub username: String,
    pub password: String,
}

struct UnlockedVault {
    path: PathBuf,
    salt: [u8; SALT_SIZE],
    key: Zeroizing<[u8; 32]>,
    entries: Vec<Entry>,
}

impl UnlockedVault {
    fn open(path: PathBuf, code: &[u8]) -> Result<Self> {
        let file = File::open(&path).map_err(|_| error("Impossible de lire le coffre."))?;
        let mut bytes = Vec::new();
        file.take(MAX_FILE_SIZE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| error("Impossible de lire le coffre."))?;
        let mut cursor = bytes.as_slice();
        if bytes.len() as u64 > MAX_FILE_SIZE || cursor.split_off(..MAGIC.len()) != Some(MAGIC) {
            return Err(error("Format de coffre invalide."));
        }
        let salt = *cursor
            .split_first_chunk::<SALT_SIZE>()
            .map(|(salt, rest)| {
                cursor = rest;
                salt
            })
            .ok_or_else(|| error("Coffre incomplet."))?;
        let (nonce, ciphertext) = cursor
            .split_first_chunk::<NONCE_SIZE>()
            .ok_or_else(|| error("Coffre incomplet."))?;
        let key = derive_key(code, &salt)?;
        let cipher = XChaCha20Poly1305::new((&*key).into());
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    XNonce::from_slice(nonce),
                    Payload {
                        msg: ciphertext,
                        aad: MAGIC,
                    },
                )
                .map_err(|_| error("Code incorrect ou coffre endommagé."))?,
        );
        let entries =
            serde_json::from_slice(&plaintext).map_err(|_| error("Contenu du coffre invalide."))?;
        Ok(Self {
            path,
            salt,
            key,
            entries,
        })
    }

    fn save(&self, create: bool) -> Result<()> {
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&self.entries)
                .map_err(|_| error("Écriture du coffre impossible."))?,
        );
        let nonce = random::<NONCE_SIZE>()?;
        let cipher = XChaCha20Poly1305::new((&*self.key).into());
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: MAGIC,
                },
            )
            .map_err(|_| error("Chiffrement du coffre impossible."))?;
        if (MAGIC.len() + SALT_SIZE + NONCE_SIZE + ciphertext.len()) as u64 > MAX_FILE_SIZE {
            return Err(error("Le coffre a atteint sa taille maximale."));
        }
        let parent = self
            .path
            .parent()
            .ok_or_else(|| error("Chemin du coffre invalide."))?;
        let mut temp = NamedTempFile::new_in(parent)
            .map_err(|_| error("Impossible de préparer le fichier du coffre."))?;
        temp.write_all(MAGIC)
            .and_then(|_| temp.write_all(&self.salt))
            .and_then(|_| temp.write_all(&nonce))
            .and_then(|_| temp.write_all(&ciphertext))
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|_| error("Impossible d’enregistrer le coffre."))?;

        let saved = if create {
            temp.persist_noclobber(&self.path)
        } else {
            temp.persist(&self.path)
        };
        saved.map_err(|_| error("Impossible de remplacer le fichier du coffre."))?;
        #[cfg(unix)]
        let _ = File::open(parent).and_then(|directory| directory.sync_all());
        Ok(())
    }
}

#[napi]
pub struct VaultSession {
    vault: Option<UnlockedVault>,
}

impl VaultSession {
    fn unlocked(&self) -> Result<&UnlockedVault> {
        self.vault
            .as_ref()
            .ok_or_else(|| error("Le coffre est verrouillé."))
    }

    fn unlocked_mut(&mut self) -> Result<&mut UnlockedVault> {
        self.vault
            .as_mut()
            .ok_or_else(|| error("Le coffre est verrouillé."))
    }
}

#[napi]
impl VaultSession {
    #[napi]
    pub fn lock(&mut self) {
        self.vault = None;
    }

    #[napi]
    pub fn entries(&self) -> Result<Vec<EntrySummary>> {
        Ok(self
            .unlocked()?
            .entries
            .iter()
            .map(|entry| EntrySummary {
                id: entry.id.clone(),
                origin: entry.origin.clone(),
                username: entry.username.clone(),
            })
            .collect())
    }

    #[napi]
    pub fn login(&self, id: String, origin: String) -> Result<Login> {
        let entry = self
            .unlocked()?
            .entries
            .iter()
            .find(|entry| entry.id == id && entry.origin == origin)
            .ok_or_else(|| error("Identifiant introuvable pour ce site."))?;
        Ok(Login {
            username: entry.username.clone(),
            password: entry.password.clone(),
        })
    }

    #[napi]
    pub fn put(
        &mut self,
        id: String,
        origin: String,
        username: String,
        password: String,
    ) -> Result<()> {
        let entry = Entry {
            id,
            origin,
            username,
            password,
        };
        let vault = self.unlocked_mut()?;
        if let Some(index) = vault.entries.iter().position(|saved| saved.id == entry.id) {
            let previous = std::mem::replace(&mut vault.entries[index], entry);
            if let Err(failure) = vault.save(false) {
                vault.entries[index] = previous;
                return Err(failure);
            }
        } else {
            vault.entries.push(entry);
            if let Err(failure) = vault.save(false) {
                vault.entries.pop();
                return Err(failure);
            }
        }
        Ok(())
    }

    #[napi]
    pub fn remove(&mut self, id: String) -> Result<()> {
        let vault = self.unlocked_mut()?;
        let index = vault
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| error("Identifiant introuvable."))?;
        let entry = vault.entries.remove(index);
        if let Err(failure) = vault.save(false) {
            vault.entries.insert(index, entry);
            return Err(failure);
        }
        Ok(())
    }
}

pub struct OpenVault {
    path: PathBuf,
    code: Zeroizing<String>,
    create: bool,
}

impl Task for OpenVault {
    type Output = VaultSession;
    type JsValue = VaultSession;

    fn compute(&mut self) -> Result<Self::Output> {
        let vault = if self.create {
            let salt = random()?;
            let key = derive_key(self.code.as_bytes(), &salt)?;
            let vault = UnlockedVault {
                path: self.path.clone(),
                salt,
                key,
                entries: Vec::new(),
            };
            vault.save(true)?;
            vault
        } else {
            UnlockedVault::open(self.path.clone(), self.code.as_bytes())?
        };
        Ok(VaultSession { vault: Some(vault) })
    }

    fn resolve(&mut self, _: Env, vault: Self::Output) -> Result<Self::JsValue> {
        Ok(vault)
    }
}

#[napi]
pub fn open_vault(path: String, code: String, create: bool) -> Result<AsyncTask<OpenVault>> {
    let code = Zeroizing::new(code);
    if code.len() > 1024 || code.is_empty() || (create && code.trim().chars().count() < 12) {
        return Err(error("Choisis un code maître d’au moins 12 caractères."));
    }
    Ok(AsyncTask::new(OpenVault {
        path: Path::new(&path).to_owned(),
        code,
        create,
    }))
}

#[napi]
pub fn vault_exists(path: String) -> Result<bool> {
    fs::exists(path).map_err(|_| error("Impossible de localiser le coffre."))
}
