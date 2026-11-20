use adblock::{
    Engine, FilterSet,
    lists::{ParseOptions, RuleTypes},
    request::Request,
};
use napi::bindgen_prelude::{AsyncTask, Env, Result, Task};
use napi_derive::napi;

mod vault;

#[napi]
pub struct NetworkFilter(Engine);

#[napi]
impl NetworkFilter {
    #[napi]
    pub fn blocks(&self, url: String, source: String, kind: String, method: String) -> bool {
        Request::new(&url, &source, &kind, &method)
            .is_ok_and(|request| self.0.check_network_request(&request).should_block())
    }
}

pub struct CompileFilter(String);

impl Task for CompileFilter {
    type Output = Engine;
    type JsValue = NetworkFilter;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut rules = FilterSet::new(false);
        let options = ParseOptions {
            rule_types: RuleTypes::NetworkOnly,
            ..Default::default()
        };
        rules.add_filter_list(std::mem::take(&mut self.0), options);
        Ok(Engine::new_with_filter_set(rules))
    }

    fn resolve(&mut self, _: Env, engine: Self::Output) -> Result<Self::JsValue> {
        Ok(NetworkFilter(engine))
    }
}

#[napi]
pub fn compile_filter(rules: String) -> AsyncTask<CompileFilter> {
    AsyncTask::new(CompileFilter(rules))
}
