//! Short ids for the offline fallback, the same rules as app/src/mcp/shortIds.ts: replies carry the
//! shortest prefix (at least 8 characters) unique among the project's objects; params accept that
//! prefix, any longer unique one (6+ characters), or the full id.

use super::client::HiveError;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

const SHORT_ID_LENGTH: usize = 8;
const MIN_PREFIX_LENGTH: usize = 6;
/// Param keys whose string values (or string arrays) name objects; `data` holds kind fields, never ids.
const ID_KEYS: [&str; 8] = ["id", "ids", "nodeId", "zoneId", "linkedTo", "node", "from", "to"];

pub struct IdIndex {
    /// (lower-cased id, id), sorted by the lower-cased form.
    sorted: Vec<(String, String)>,
    known: HashSet<String>,
    short: HashMap<String, String>,
}

impl IdIndex {
    pub fn new(ids: impl IntoIterator<Item = String>) -> Self {
        let known: HashSet<String> = ids.into_iter().filter(|id| !id.is_empty()).collect();
        let mut sorted: Vec<(String, String)> = known.iter().map(|id| (id.to_lowercase(), id.clone())).collect();
        sorted.sort();
        let mut short = HashMap::new();
        for (index, (key, id)) in sorted.iter().enumerate() {
            let before = index.checked_sub(1).map_or(0, |previous| common_prefix(key, &sorted[previous].0));
            let after = sorted.get(index + 1).map_or(0, |(next, _)| common_prefix(key, next));
            let length = SHORT_ID_LENGTH.max(before.max(after) + 1);
            short.insert(id.clone(), id.chars().take(length).collect());
        }
        Self { sorted, known, short }
    }

    /// The reply form of `id`; ids the index does not know come back unchanged.
    pub fn short(&self, id: &str) -> String {
        self.short.get(id).cloned().unwrap_or_else(|| id.to_string())
    }

    /// A full id for an exact id or a unique prefix of 6+ characters; other values come back unchanged.
    pub fn resolve(&self, value: &str) -> Result<String, HiveError> {
        if self.known.contains(value) || value.chars().count() < MIN_PREFIX_LENGTH {
            return Ok(value.to_string());
        }
        let prefix = value.to_lowercase();
        let start = self.sorted.partition_point(|(key, _)| key.as_str() < prefix.as_str());
        let matches: Vec<&String> = self.sorted[start..]
            .iter()
            .take_while(|(key, _)| key.starts_with(&prefix))
            .map(|(_, id)| id)
            .collect();
        match matches.len() {
            0 => Ok(value.to_string()),
            1 => Ok(matches[0].clone()),
            _ => {
                let listed: Vec<&str> = matches.iter().take(5).map(|id| id.as_str()).collect();
                Err(HiveError {
                    code: "invalid_params".into(),
                    message: format!("Id '{value}' is ambiguous: matches {}; use more characters.", listed.join(", ")),
                    data: Some(json!({ "id": value, "matches": matches })),
                })
            }
        }
    }

    /// A copy of `value` where every string that is exactly a known id is replaced by its short form.
    pub fn shorten(&self, value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.short(text)),
            Value::Array(items) => Value::Array(items.iter().map(|item| self.shorten(item)).collect()),
            Value::Object(map) => Value::Object(map.iter().map(|(key, item)| (key.clone(), self.shorten(item))).collect()),
            other => other.clone(),
        }
    }

    /// A copy of `params` with short ids under id keys replaced by full ids (never refs of the call).
    pub fn expand_params(&self, params: &Value) -> Result<Value, HiveError> {
        let mut refs = HashSet::new();
        collect_refs(params, &mut refs);
        self.expand(params, None, &refs)
    }

    fn expand(&self, value: &Value, key: Option<&str>, refs: &HashSet<String>) -> Result<Value, HiveError> {
        let resolve = |text: &String| -> Result<Value, HiveError> {
            if refs.contains(text) {
                Ok(Value::String(text.clone()))
            } else {
                self.resolve(text).map(Value::String)
            }
        };
        if key == Some("data") {
            return Ok(value.clone());
        }
        let id_key = key.is_some_and(|key| ID_KEYS.contains(&key));
        match value {
            Value::String(text) if id_key => resolve(text),
            Value::Array(items) => items
                .iter()
                .map(|item| match item {
                    Value::String(text) if id_key => resolve(text),
                    other => self.expand(other, None, refs),
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            Value::Object(map) => {
                let mut out = Map::new();
                for (child_key, child) in map {
                    out.insert(child_key.clone(), self.expand(child, Some(child_key), refs)?);
                }
                Ok(Value::Object(out))
            }
            other => Ok(other.clone()),
        }
    }
}

fn collect_refs(value: &Value, refs: &mut HashSet<String>) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| collect_refs(item, refs)),
        Value::Object(map) => {
            for (key, child) in map {
                match (key.as_str(), child) {
                    ("ref", Value::String(text)) => {
                        refs.insert(text.clone());
                    }
                    ("data", _) => {}
                    _ => collect_refs(child, refs),
                }
            }
        }
        _ => {}
    }
}

fn common_prefix(first: &str, second: &str) -> usize {
    first.chars().zip(second.chars()).take_while(|(a, b)| a == b).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "3f2a9c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
    const B: &str = "c4a37248-bdd7-418c-a36e-bcee6d831da1";
    const TWIN_1: &str = "aaaaaaaa-1111-4111-8111-111111111111";
    const TWIN_2: &str = "aaaaaaaa-2222-4222-8222-222222222222";

    fn index(ids: &[&str]) -> IdIndex {
        IdIndex::new(ids.iter().map(|id| id.to_string()))
    }

    #[test]
    fn short_form_is_8_chars() {
        let index = index(&[A, B]);
        assert_eq!(index.short(A), "3f2a9c1e");
        assert_eq!(index.short(B), "c4a37248");
    }

    #[test]
    fn colliding_prefixes_grow() {
        let index = index(&[TWIN_1, TWIN_2, A]);
        assert_eq!(index.short(TWIN_1), "aaaaaaaa-1");
        assert_eq!(index.short(TWIN_2), "aaaaaaaa-2");
        assert_eq!(index.short("me"), "me");
    }

    #[test]
    fn resolve_exact_prefix_unknown() {
        let index = index(&[A, B, "n1"]);
        assert_eq!(index.resolve(A).unwrap(), A);
        assert_eq!(index.resolve("3f2a9c1e").unwrap(), A);
        assert_eq!(index.resolve("3F2A9C").unwrap(), A);
        assert_eq!(index.resolve("n1").unwrap(), "n1");
        assert_eq!(index.resolve("zzzzzz").unwrap(), "zzzzzz");
        assert_eq!(index.resolve("3f2a9").unwrap(), "3f2a9");
    }

    #[test]
    fn ambiguous_prefix_errors() {
        let error = index(&[TWIN_1, TWIN_2]).resolve("aaaaaaaa").unwrap_err();
        assert_eq!(error.code, "invalid_params");
        assert!(error.message.contains(TWIN_1) && error.message.contains(TWIN_2));
    }

    #[test]
    fn shorten_replaces_exact_matches_only() {
        let index = index(&[A, B]);
        let value = index.shorten(&json!({ "id": A, "links": [{ "from": A, "to": B }], "text": format!("see {A}") }));
        assert_eq!(value, json!({ "id": "3f2a9c1e", "links": [{ "from": "3f2a9c1e", "to": "c4a37248" }], "text": format!("see {A}") }));
    }

    #[test]
    fn only_id_keys_are_expanded() {
        let index = index(&[A, B]);
        let untouched = json!({ "query": "3f2a9c1e", "names": ["3f2a9c1e"], "data": { "id": "3f2a9c1e" } });
        assert_eq!(index.expand_params(&untouched).unwrap(), untouched);
        let expanded = index.expand_params(&json!({ "ids": ["3f2a9c1e", B], "zoneId": "c4a37248", "linkedTo": "3f2a9c1e", "nodeId": "c4a37248" })).unwrap();
        assert_eq!(expanded, json!({ "ids": [A, B], "zoneId": B, "linkedTo": A, "nodeId": B }));
    }

    #[test]
    fn refs_are_not_expanded() {
        let index = index(&["abc12345-0000-4000-8000-000000000000", A]);
        let params = json!({ "nodes": [{ "ref": "abc123" }], "links": [{ "from": "abc123", "to": "3f2a9c1e" }] });
        assert_eq!(index.expand_params(&params).unwrap(), json!({ "nodes": [{ "ref": "abc123" }], "links": [{ "from": "abc123", "to": A }] }));
    }
}
