//! YouTube enrichment for `read_node_content` / `read_youtube` (hive's webview CSP blocks this, so
//! the MCP side does it). Best effort: offline, region-locked or changed pages degrade to what is known.
//! Captions come through the innertube player API with the ANDROID or IOS client (the watch page's
//! caption URLs need a browser token) — see the vault knowledge card on YouTube captions.

use super::client::HiveError;
use base64::Engine;
use serde_json::{json, Map, Value};
use std::io::Read;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_TRANSCRIPT_CHARS: usize = 60_000;

#[derive(Default)]
pub struct YouTubeInfo {
    pub video_id: String,
    pub url: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub author_url: Option<String>,
    pub description: Option<String>,
    pub length_seconds: Option<f64>,
    pub view_count: Option<f64>,
    /// base64 JPEG
    pub thumbnail: Option<String>,
    pub transcript: Option<Value>,
    pub available_languages: Option<Vec<String>>,
    pub notes: Vec<String>,
}

impl YouTubeInfo {
    /// Everything except the thumbnail bytes.
    pub fn to_json(&self) -> Value {
        let mut out = Map::new();
        out.insert("videoId".into(), json!(self.video_id));
        out.insert("url".into(), json!(self.url));
        let optional: [(&str, Option<Value>); 8] = [
            ("title", self.title.clone().map(Value::from)),
            ("author", self.author.clone().map(Value::from)),
            ("authorUrl", self.author_url.clone().map(Value::from)),
            ("description", self.description.clone().map(Value::from)),
            ("lengthSeconds", self.length_seconds.map(Value::from)),
            ("viewCount", self.view_count.map(Value::from)),
            ("transcript", self.transcript.clone()),
            ("availableTranscriptLanguages", self.available_languages.clone().map(|list| json!(list))),
        ];
        for (key, value) in optional {
            if let Some(value) = value {
                out.insert(key.into(), value);
            }
        }
        out.insert("notes".into(), json!(self.notes));
        Value::Object(out)
    }
}

fn valid_id(value: &str) -> bool {
    value.len() == 11 && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Accepts youtu.be, watch?v=, /shorts/, /embed/, /live/, /v/, m./music./www. hosts and bare ids.
pub fn video_id(input: &str) -> Option<String> {
    let value = input.trim();
    if valid_id(value) {
        return Some(value.to_string());
    }
    let with_scheme = if value.contains("://") { value.to_string() } else { format!("https://{value}") };
    let url = url::Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?.to_lowercase();
    let host = host.strip_prefix("www.").or_else(|| host.strip_prefix("m.")).or_else(|| host.strip_prefix("music.")).unwrap_or(&host).to_string();
    let segments: Vec<&str> = url.path_segments().map(Iterator::collect).unwrap_or_default();
    if host == "youtu.be" {
        return segments.first().filter(|id| valid_id(id)).map(|id| id.to_string());
    }
    if host != "youtube.com" && host != "youtube-nocookie.com" {
        return None;
    }
    if let Some((_, id)) = url.query_pairs().find(|(key, _)| key == "v") {
        if valid_id(&id) {
            return Some(id.to_string());
        }
    }
    match segments.as_slice() {
        [first, second, ..] if ["shorts", "embed", "live", "v", "e"].contains(first) && valid_id(second) => Some(second.to_string()),
        _ => None,
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(TIMEOUT).build()
}

fn error_text(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(code, _) => format!("HTTP {code}"),
        ureq::Error::Transport(transport) => transport.to_string(),
    }
}

const PLAYER_CLIENTS: [(&str, &str); 2] = [
    (
        r#"{"clientName":"ANDROID","clientVersion":"20.10.38","androidSdkVersion":30,"hl":"en"}"#,
        "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    ),
    (
        r#"{"clientName":"IOS","clientVersion":"20.10.4","deviceModel":"iPhone16,2","hl":"en"}"#,
        "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)",
    ),
];

fn fetch_player(video_id: &str) -> Result<Value, String> {
    let mut last_error = "no client answered".to_string();
    for (client, user_agent) in PLAYER_CLIENTS {
        let client: Value = serde_json::from_str(client).unwrap_or(Value::Null);
        let body = json!({ "context": { "client": client }, "videoId": video_id }).to_string();
        let response = agent()
            .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .set("Content-Type", "application/json")
            .set("User-Agent", user_agent)
            .send_string(&body);
        match response {
            Ok(response) => match response.into_string().ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()) {
                Some(player) => {
                    let status = player.pointer("/playabilityStatus/status").and_then(Value::as_str).unwrap_or("unavailable");
                    if status == "OK" {
                        return Ok(player);
                    }
                    last_error = format!("video is {status}");
                }
                None => last_error = "unreadable player response".to_string(),
            },
            Err(error) => last_error = error_text(error),
        }
    }
    Err(last_error)
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find(';').filter(|end| *end <= 10) else {
            out.push('&');
            rest = after;
            continue;
        };
        let name = &after[..end];
        let decoded = match name.to_lowercase().as_str() {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            lower if lower.starts_with("#x") => u32::from_str_radix(&lower[2..], 16).ok().and_then(char::from_u32),
            lower if lower.starts_with('#') => lower[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &after[end + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// Caption bodies come as json3 or as timedtext XML (format 3 `<p>` or legacy `<text>`).
pub fn parse_captions(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.starts_with('{') {
        let Ok(json) = serde_json::from_str::<Value>(trimmed) else { return String::new() };
        let lines: Vec<String> = json
            .get("events")
            .and_then(Value::as_array)
            .map(|events| {
                events
                    .iter()
                    .map(|event| {
                        event
                            .get("segs")
                            .and_then(Value::as_array)
                            .map(|segs| segs.iter().filter_map(|seg| seg.get("utf8").and_then(Value::as_str)).collect::<String>())
                            .unwrap_or_default()
                    })
                    .filter(|line| !line.trim().is_empty())
                    .collect()
            })
            .unwrap_or_default();
        return lines.join(" ").split_whitespace().collect::<Vec<_>>().join(" ");
    }
    let mut lines = Vec::new();
    let mut rest = trimmed;
    loop {
        let p = rest.find("<p");
        let t = rest.find("<text");
        let (start, tag) = match (p, t) {
            (Some(p), Some(t)) if t < p => (t, "text"),
            (Some(p), _) => (p, "p"),
            (None, Some(t)) => (t, "text"),
            (None, None) => break,
        };
        let after_name = &rest[start + 1 + tag.len()..];
        // `<p` must be a whole tag name (not `<pre`), `<text` likewise.
        if !after_name.starts_with(|c: char| c == '>' || c.is_whitespace()) {
            rest = after_name;
            continue;
        }
        let Some(open_end) = after_name.find('>') else { break };
        let inner_start = &after_name[open_end + 1..];
        let close = format!("</{tag}>");
        let Some(close_at) = inner_start.find(&close) else { break };
        let line = decode_entities(&strip_tags(&inner_start[..close_at])).split_whitespace().collect::<Vec<_>>().join(" ");
        if !line.is_empty() {
            lines.push(line);
        }
        rest = &inner_start[close_at + close.len()..];
    }
    lines.join(" ")
}

fn fetch_transcript(base_url: &str) -> Result<String, String> {
    // YouTube rate-limits caption downloads (429) in bursts; one short back-off usually clears it.
    for attempt in 0.. {
        match agent().get(base_url).call() {
            Ok(response) => return Ok(parse_captions(&response.into_string().unwrap_or_default())),
            Err(ureq::Error::Status(429, _)) if attempt < 2 => std::thread::sleep(Duration::from_millis(1_500 * (attempt + 1))),
            Err(ureq::Error::Status(429, _)) => {
                return Err("YouTube is rate-limiting transcript downloads from this network right now; try read_youtube again in a while".into())
            }
            Err(error) => return Err(format!("captions {}", error_text(error))),
        }
    }
    unreachable!()
}

fn pick_track<'a>(tracks: &'a [Value], preferred: Option<&str>) -> Option<&'a Value> {
    let lang = |track: &Value| track.get("languageCode").and_then(Value::as_str).unwrap_or("").to_string();
    let is_asr = |track: &Value| track.get("kind").and_then(Value::as_str) == Some("asr");
    let manual: Vec<&Value> = tracks.iter().filter(|track| !is_asr(track)).collect();
    if let Some(preferred) = preferred {
        if let Some(track) = manual.iter().find(|track| lang(track).starts_with(preferred)) {
            return Some(track);
        }
        if let Some(track) = tracks.iter().find(|track| lang(track).starts_with(preferred)) {
            return Some(track);
        }
    }
    manual.first().copied().or_else(|| tracks.first())
}

pub fn read(input: &str, transcript: bool, lang: Option<&str>, thumbnail: bool) -> Result<YouTubeInfo, HiveError> {
    let video_id = video_id(input).ok_or_else(|| HiveError::new("invalid_params", format!("Not a YouTube video URL or id: {input}")))?;
    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let mut info = YouTubeInfo { video_id: video_id.clone(), url: url.clone(), ..Default::default() };

    let (oembed, thumb, player) = std::thread::scope(|scope| {
        let oembed = scope.spawn(|| {
            let encoded = percent_encoding::utf8_percent_encode(&url, percent_encoding::NON_ALPHANUMERIC).to_string();
            agent()
                .get(&format!("https://www.youtube.com/oembed?format=json&url={encoded}"))
                .call()
                .map_err(error_text)
                .and_then(|response| response.into_string().map_err(|error| error.to_string()))
                .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|error| error.to_string()))
        });
        let thumb = scope.spawn(|| {
            if !thumbnail {
                return None;
            }
            for name in ["maxresdefault", "hqdefault"] {
                let Ok(response) = agent().get(&format!("https://i.ytimg.com/vi/{video_id}/{name}.jpg")).call() else { continue };
                let mut bytes = Vec::new();
                if response.into_reader().take(8 * 1024 * 1024).read_to_end(&mut bytes).is_err() {
                    continue;
                }
                // YouTube's grey "no thumbnail" placeholder is tiny.
                if bytes.len() >= 2_000 {
                    return Some(base64::engine::general_purpose::STANDARD.encode(bytes));
                }
            }
            None
        });
        let player = scope.spawn(|| fetch_player(&video_id));
        (oembed.join().unwrap_or(Err("failed".into())), thumb.join().unwrap_or(None), player.join().unwrap_or(Err("failed".into())))
    });

    match oembed {
        Ok(body) => {
            info.title = body.get("title").and_then(Value::as_str).map(str::to_string);
            info.author = body.get("author_name").and_then(Value::as_str).map(str::to_string);
            info.author_url = body.get("author_url").and_then(Value::as_str).map(str::to_string);
        }
        Err(error) => info.notes.push(format!("oEmbed unavailable: {error}")),
    }
    if thumbnail {
        if thumb.is_none() {
            info.notes.push("Thumbnail unavailable.".into());
        }
        info.thumbnail = thumb;
    }
    match player {
        Ok(player) => {
            let details = player.get("videoDetails").cloned().unwrap_or(Value::Null);
            if info.title.is_none() {
                info.title = details.get("title").and_then(Value::as_str).map(str::to_string);
            }
            if info.author.is_none() {
                info.author = details.get("author").and_then(Value::as_str).map(str::to_string);
            }
            info.description = details.get("shortDescription").and_then(Value::as_str).map(str::to_string);
            info.length_seconds = details.get("lengthSeconds").and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_f64()));
            info.view_count = details.get("viewCount").and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_f64()));
            if transcript {
                let tracks: Vec<Value> = player
                    .pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                if tracks.is_empty() {
                    info.notes.push("This video has no captions, so no transcript is available.".into());
                } else if let Some(track) = pick_track(&tracks, lang) {
                    match fetch_transcript(track.get("baseUrl").and_then(Value::as_str).unwrap_or("")) {
                        Ok(text) if text.is_empty() => info.notes.push("Captions exist but YouTube returned an empty transcript.".into()),
                        Ok(text) => {
                            let truncated = text.chars().count() > MAX_TRANSCRIPT_CHARS;
                            info.transcript = Some(json!({
                                "language": track.get("languageCode"),
                                "auto": track.get("kind").and_then(Value::as_str) == Some("asr"),
                                "text": text.chars().take(MAX_TRANSCRIPT_CHARS).collect::<String>(),
                                "truncated": truncated,
                            }));
                            info.available_languages = Some(
                                tracks
                                    .iter()
                                    .map(|track| {
                                        let code = track.get("languageCode").and_then(Value::as_str).unwrap_or("?");
                                        if track.get("kind").and_then(Value::as_str) == Some("asr") { format!("{code} (auto)") } else { code.to_string() }
                                    })
                                    .collect(),
                            );
                        }
                        Err(error) => info.notes.push(format!("Video details/transcript unavailable: {error}")),
                    }
                }
            }
        }
        Err(error) => info.notes.push(format!("Video details/transcript unavailable: {error}")),
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_video_ids() {
        assert_eq!(video_id("dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://youtu.be/dQw4w9WgXcQ?t=3").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("m.youtube.com/shorts/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://example.com/watch?v=dQw4w9WgXcQ"), None);
    }

    #[test]
    fn parses_caption_formats() {
        assert_eq!(parse_captions(r#"{"events":[{"segs":[{"utf8":"Hello "},{"utf8":"there"}]},{"segs":[{"utf8":"\n"}]},{"segs":[{"utf8":"again"}]}]}"#), "Hello there again");
        assert_eq!(parse_captions(r#"<timedtext><body><p t="0"><s>Tom &amp; Jerry</s></p><p t="1">it&#39;s</p></body></timedtext>"#), "Tom & Jerry it's");
        assert_eq!(parse_captions(r#"<transcript><text start="0">one</text><text start="1">two</text></transcript>"#), "one two");
    }
}
