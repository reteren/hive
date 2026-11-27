//! What an agent reads costs tokens: every tool result goes out once, as compact JSON, with
//! fractions rounded to 2 decimals and empty nested fields left out.

use serde_json::{Map, Value};

/// The value an agent gets: fractions rounded to 2 decimals; inside nested objects, fields that are
/// `null`, `[]` or `{}` are left out. Top-level keys stay, so "nothing found" is still explicit.
pub fn compact(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(map.iter().map(|(key, item)| (key.clone(), nested(item))).collect()),
        other => nested(other),
    }
}

/// `compact` serialized on one line.
pub fn compact_text(value: &Value) -> String {
    compact(value).to_string()
}

fn nested(value: &Value) -> Value {
    match value {
        Value::Number(number) => round(number),
        Value::Array(items) => Value::Array(items.iter().map(nested).collect()),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, item) in map {
                let item = nested(item);
                if !is_empty(&item) {
                    out.insert(key.clone(), item);
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(items) => items.is_empty(),
        Value::Object(map) => map.is_empty(),
        _ => false,
    }
}

fn round(number: &serde_json::Number) -> Value {
    if number.is_i64() || number.is_u64() {
        return Value::Number(number.clone());
    }
    let Some(float) = number.as_f64() else { return Value::Number(number.clone()) };
    let rounded = (float * 100.0).round() / 100.0;
    if rounded.fract() == 0.0 && rounded.abs() < 9.0e15 {
        Value::from(rounded as i64)
    } else {
        serde_json::Number::from_f64(rounded).map_or(Value::Null, Value::Number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rounds_fractions_keeps_integers() {
        let value = compact(&json!({ "x": 249.37680395418988, "o": 0.924, "t": 1791290832123u64, "w": 2.0, "n": -3.005001 }));
        assert_eq!(value, json!({ "x": 249.38, "o": 0.92, "t": 1791290832123u64, "w": 2, "n": -3.01 }));
    }

    #[test]
    fn drops_empty_nested_fields() {
        let value = compact(&json!({ "a": { "x": null, "y": [], "z": {}, "k": 1 } }));
        assert_eq!(value, json!({ "a": { "k": 1 } }));
    }

    #[test]
    fn keeps_top_level_keys() {
        let value = compact(&json!({ "nodes": [], "selection": [], "x": null }));
        assert_eq!(value, json!({ "nodes": [], "selection": [], "x": null }));
    }

    #[test]
    fn arrays_keep_positions() {
        assert_eq!(compact(&json!([null, 1.234, { "a": null }])), json!([null, 1.23, {}]));
    }

    #[test]
    fn compact_text_has_no_newlines() {
        let text = compact_text(&json!({ "nodes": [{ "id": "a", "name": "two\nlines" }] }));
        assert!(!text.contains('\n'));
        assert_eq!(text, r#"{"nodes":[{"id":"a","name":"two\nlines"}]}"#);
    }
}
