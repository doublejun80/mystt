use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug)]
struct RecorderStorePaths {
    recorder_root: PathBuf,
    recordings_root: PathBuf,
    ledger_path: PathBuf,
    runtime_state_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRecorderStoreStatus {
    platform: String,
    recorder_root: String,
    recordings_root: String,
    ledger_path: String,
    runtime_state_path: String,
    has_runtime_state: bool,
    saved_session_count: usize,
    runtime_state: Option<Value>,
    recent_sessions: Vec<Value>,
}

fn resolve_store_paths(app: &AppHandle) -> Result<RecorderStorePaths, String> {
    let path = app.path();
    let app_data_dir = path
        .app_local_data_dir()
        .or_else(|_| path.app_data_dir())
        .map_err(|error| error.to_string())?;
    let recorder_root = app_data_dir.join("mystt-recorder");
    let recordings_root = recorder_root.join("recordings");

    Ok(RecorderStorePaths {
        recorder_root: recorder_root.clone(),
        recordings_root,
        ledger_path: recorder_root.join("sessions.json"),
        runtime_state_path: recorder_root.join("runtime-state.json"),
    })
}

fn ensure_store_layout(paths: &RecorderStorePaths) -> Result<(), String> {
    fs::create_dir_all(&paths.recorder_root).map_err(|error| error.to_string())?;
    fs::create_dir_all(&paths.recordings_root).map_err(|error| error.to_string())?;
    Ok(())
}

fn read_json_value(path: &PathBuf) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;

    if content.trim().is_empty() {
        return Ok(None);
    }

    let value = serde_json::from_str::<Value>(&content).map_err(|error| error.to_string())?;
    Ok(Some(value))
}

fn read_json_array(path: &PathBuf) -> Result<Vec<Value>, String> {
    match read_json_value(path)? {
        Some(Value::Array(values)) => Ok(values),
        Some(_) => Err(format!("{} must contain a JSON array", path.display())),
        None => Ok(Vec::new()),
    }
}

fn write_pretty_json(path: &PathBuf, value: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn normalize_session_entry(
    paths: &RecorderStorePaths,
    mut entry: Value,
) -> Result<(String, Value), String> {
    let session_id = entry
        .get("session")
        .and_then(|session| session.get("id"))
        .and_then(Value::as_str)
        .ok_or("recorder session entry must include session.id")?
        .to_string();

    let session_dir = paths.recordings_root.join(&session_id);
    let session_json_path = session_dir.join("session.json");

    fs::create_dir_all(&session_dir).map_err(|error| error.to_string())?;

    if let Some(object) = entry.as_object_mut() {
        object.insert(
            "sessionJsonPath".to_string(),
            Value::String(session_json_path.display().to_string()),
        );
        object.insert(
            "runtimeStatePath".to_string(),
            Value::String(paths.runtime_state_path.display().to_string()),
        );
        object
            .entry("savedAt".to_string())
            .or_insert(Value::String(now_iso_like()));
        object
            .entry("uploadState".to_string())
            .or_insert(Value::String("local-only".to_string()));
        object
            .entry("phaseHistory".to_string())
            .or_insert(Value::Array(Vec::new()));
        object
            .entry("operationLog".to_string())
            .or_insert(Value::Array(Vec::new()));
        object
            .entry("evidenceLog".to_string())
            .or_insert(Value::Array(Vec::new()));
    }

    write_pretty_json(&session_json_path, &entry)?;

    Ok((session_id, entry))
}

fn entry_sort_key(entry: &Value) -> String {
    entry
        .get("savedAt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn build_store_status_from_paths(
    platform: &str,
    paths: &RecorderStorePaths,
) -> Result<DesktopRecorderStoreStatus, String> {
    ensure_store_layout(paths)?;

    let runtime_state = read_json_value(&paths.runtime_state_path)?;
    let mut recent_sessions = read_json_array(&paths.ledger_path)?;
    recent_sessions.sort_by(|left, right| entry_sort_key(right).cmp(&entry_sort_key(left)));
    recent_sessions.truncate(6);

    let saved_session_count = read_json_array(&paths.ledger_path)?.len();

    Ok(DesktopRecorderStoreStatus {
        platform: platform.to_string(),
        recorder_root: paths.recorder_root.display().to_string(),
        recordings_root: paths.recordings_root.display().to_string(),
        ledger_path: paths.ledger_path.display().to_string(),
        runtime_state_path: paths.runtime_state_path.display().to_string(),
        has_runtime_state: runtime_state.is_some(),
        saved_session_count,
        runtime_state,
        recent_sessions,
    })
}

fn now_iso_like() -> String {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    format!("unix:{unix}")
}

#[tauri::command]
pub fn desktop_recorder_store_status(app: AppHandle) -> Result<DesktopRecorderStoreStatus, String> {
    let paths = resolve_store_paths(&app)?;
    build_store_status_from_paths(std::env::consts::OS, &paths)
}

#[tauri::command]
pub fn desktop_recorder_store_runtime(
    app: AppHandle,
    runtime_state: Value,
) -> Result<DesktopRecorderStoreStatus, String> {
    let paths = resolve_store_paths(&app)?;
    ensure_store_layout(&paths)?;
    write_pretty_json(&paths.runtime_state_path, &runtime_state)?;
    build_store_status_from_paths(std::env::consts::OS, &paths)
}

#[tauri::command]
pub fn desktop_recorder_clear_runtime(
    app: AppHandle,
) -> Result<DesktopRecorderStoreStatus, String> {
    let paths = resolve_store_paths(&app)?;
    ensure_store_layout(&paths)?;

    if paths.runtime_state_path.exists() {
        fs::remove_file(&paths.runtime_state_path).map_err(|error| error.to_string())?;
    }

    build_store_status_from_paths(std::env::consts::OS, &paths)
}

#[tauri::command]
pub fn desktop_recorder_store_session(
    app: AppHandle,
    entry: Value,
) -> Result<DesktopRecorderStoreStatus, String> {
    let paths = resolve_store_paths(&app)?;
    ensure_store_layout(&paths)?;
    let (session_id, normalized_entry) = normalize_session_entry(&paths, entry)?;
    let mut ledger = read_json_array(&paths.ledger_path)?;

    ledger.retain(|item| {
        item.get("session")
            .and_then(|session| session.get("id"))
            .and_then(Value::as_str)
            != Some(session_id.as_str())
    });
    ledger.insert(0, normalized_entry);
    ledger.sort_by(|left, right| entry_sort_key(right).cmp(&entry_sort_key(left)));

    write_pretty_json(&paths.ledger_path, &Value::Array(ledger))?;

    build_store_status_from_paths(std::env::consts::OS, &paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_test_paths(name: &str) -> RecorderStorePaths {
        let unique = format!(
            "mystt-recorder-test-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default()
        );
        let root = std::env::temp_dir().join(unique);

        RecorderStorePaths {
            recorder_root: root.clone(),
            recordings_root: root.join("recordings"),
            ledger_path: root.join("sessions.json"),
            runtime_state_path: root.join("runtime-state.json"),
        }
    }

    #[test]
    fn builds_empty_status_for_new_store() {
        let paths = build_test_paths("empty");
        let status = build_store_status_from_paths("test", &paths).expect("status should build");

        assert_eq!(status.saved_session_count, 0);
        assert!(!status.has_runtime_state);
        assert!(status.recent_sessions.is_empty());
        assert!(PathBuf::from(status.recorder_root).exists());
    }

    #[test]
    fn persists_runtime_and_session_entries() {
        let paths = build_test_paths("persist");
        ensure_store_layout(&paths).expect("store layout");
        write_pretty_json(
            &paths.runtime_state_path,
            &serde_json::json!({
                "transportState": "recording",
                "phase": "recording_foreground",
                "lastKnownAppState": "active"
            }),
        )
        .expect("runtime write");

        let (_, entry) = normalize_session_entry(
            &paths,
            serde_json::json!({
                "session": {
                    "id": "sess_test",
                    "title": "Desktop rehearsal",
                    "mode": "meeting",
                    "status": "recording",
                    "startedAt": "2026-04-10T00:00:00.000Z",
                    "participants": [],
                    "languageHints": ["ko", "en"],
                    "localAudioPath": "recordings/sess_test/source.m4a",
                    "profile": {
                        "chunkMinutes": 10,
                        "uploadStrategy": "rolling-chunks",
                        "backgroundSurvivalCritical": true,
                        "allowForegroundRealtime": true,
                        "minimumBatteryPercentToStream": 25
                    },
                    "realtimePolicy": "foreground-only",
                    "pendingChunkCount": 0,
                    "artifacts": []
                },
                "durationMillis": 1234,
                "sizeBytes": 4321,
                "savedAt": "2026-04-10T00:01:00.000Z"
            }),
        )
        .expect("normalize entry");

        write_pretty_json(&paths.ledger_path, &Value::Array(vec![entry])).expect("ledger write");

        let status = build_store_status_from_paths("test", &paths).expect("status should build");

        assert!(status.has_runtime_state);
        assert_eq!(status.saved_session_count, 1);
        assert_eq!(status.recent_sessions.len(), 1);
        assert_eq!(
            status.recent_sessions[0]
                .get("session")
                .and_then(|session| session.get("id"))
                .and_then(Value::as_str),
            Some("sess_test")
        );
    }
}
