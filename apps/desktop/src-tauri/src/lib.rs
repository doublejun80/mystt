use serde::Serialize;
use std::fs;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

mod recorder_store;

#[derive(Default)]
struct DesktopKeepAwakeState(Mutex<Option<Child>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopShellStatus {
    platform: String,
    app_data_dir: String,
    app_cache_dir: String,
    app_log_dir: String,
    downloads_dir: String,
    recorder_root: String,
    runtime_state_path: String,
    review_only_portal: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopKeepAwakeStatus {
    supported: bool,
    active: bool,
    mode: String,
    detail: String,
}

fn resolve_downloads_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let path = app.path();

    path.download_dir()
        .or_else(|_| path.home_dir().map(|home| home.join("Downloads")))
        .map_err(|error| error.to_string())
}

fn sanitize_download_name(file_name: &str) -> String {
    let cleaned = file_name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => character,
        })
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() {
        "mystt-audio".to_string()
    } else {
        cleaned
    }
}

fn resolve_unique_download_path(
    directory: &std::path::Path,
    file_name: &str,
) -> std::path::PathBuf {
    let candidate = directory.join(file_name);

    if !candidate.exists() {
        return candidate;
    }

    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("mystt-audio");
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    for index in 1..1000 {
        let next = directory.join(format!("{stem}-{index}{extension}"));
        if !next.exists() {
            return next;
        }
    }

    directory.join(format!("{stem}-copy{extension}"))
}

#[tauri::command]
fn desktop_shell_status(app: AppHandle) -> Result<DesktopShellStatus, String> {
    let path = app.path();
    let app_data_dir = path
        .app_local_data_dir()
        .or_else(|_| path.app_data_dir())
        .map_err(|error| error.to_string())?;
    let app_cache_dir = path.app_cache_dir().map_err(|error| error.to_string())?;
    let app_log_dir = path.app_log_dir().map_err(|error| error.to_string())?;
    let downloads_dir = resolve_downloads_dir(&app)?;
    let recorder_root = app_data_dir.join("mystt-recorder");

    fs::create_dir_all(&recorder_root).map_err(|error| error.to_string())?;

    Ok(DesktopShellStatus {
        platform: std::env::consts::OS.to_string(),
        app_data_dir: app_data_dir.display().to_string(),
        app_cache_dir: app_cache_dir.display().to_string(),
        app_log_dir: app_log_dir.display().to_string(),
        downloads_dir: downloads_dir.display().to_string(),
        recorder_root: recorder_root.display().to_string(),
        runtime_state_path: recorder_root
            .join("runtime-state.json")
            .display()
            .to_string(),
        review_only_portal: false,
    })
}

#[tauri::command]
async fn desktop_download_file(
    app: AppHandle,
    url: String,
    file_name: String,
) -> Result<String, String> {
    let downloads_dir = resolve_downloads_dir(&app)?;
    fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;

    let target_path = resolve_unique_download_path(&downloads_dir, &sanitize_download_name(&file_name));
    let response = reqwest::get(&url)
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("다운로드 실패: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    fs::write(&target_path, &bytes).map_err(|error| error.to_string())?;

    Ok(target_path.display().to_string())
}

#[tauri::command]
fn desktop_keep_awake_status(state: tauri::State<DesktopKeepAwakeState>) -> DesktopKeepAwakeStatus {
    #[cfg(target_os = "macos")]
    {
        let mut guard = state.0.lock().expect("desktop keep awake mutex poisoned");
        let active = guard
            .as_mut()
            .map(|child| matches!(child.try_wait(), Ok(None)))
            .unwrap_or(false);

        if !active {
            *guard = None;
        }

        DesktopKeepAwakeStatus {
            supported: true,
            active,
            mode: "caffeinate".to_string(),
            detail: if active {
                "macOS caffeinate 로 시스템/디스플레이 절전을 막는 중입니다.".to_string()
            } else {
                "장시간 녹음 전에는 절전 방지 레인을 켜 두는 것을 권장합니다.".to_string()
            },
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        DesktopKeepAwakeStatus {
            supported: false,
            active: false,
            mode: "unsupported".to_string(),
            detail: "현재 플랫폼용 keep-awake 어댑터는 아직 구현되지 않았습니다.".to_string(),
        }
    }
}

#[tauri::command]
fn desktop_keep_awake_start(
    state: tauri::State<DesktopKeepAwakeState>,
) -> Result<DesktopKeepAwakeStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let mut guard = state.0.lock().map_err(|error| error.to_string())?;

        if guard
            .as_mut()
            .map(|child| matches!(child.try_wait(), Ok(None)))
            .unwrap_or(false)
        {
            return Ok(DesktopKeepAwakeStatus {
                supported: true,
                active: true,
                mode: "caffeinate".to_string(),
                detail: "이미 keep-awake 보호가 켜져 있습니다.".to_string(),
            });
        }

        let child = Command::new("caffeinate")
            .args(["-d", "-i", "-m", "-s", "-u"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())?;

        *guard = Some(child);

        Ok(DesktopKeepAwakeStatus {
            supported: true,
            active: true,
            mode: "caffeinate".to_string(),
            detail: "keep-awake 보호를 시작했습니다. 장시간 세션 동안 절전을 최대한 막습니다."
                .to_string(),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Err("현재 플랫폼용 keep-awake 어댑터는 아직 구현되지 않았습니다.".to_string())
    }
}

#[tauri::command]
fn desktop_keep_awake_stop(
    state: tauri::State<DesktopKeepAwakeState>,
) -> Result<DesktopKeepAwakeStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let mut guard = state.0.lock().map_err(|error| error.to_string())?;

        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }

        *guard = None;

        Ok(DesktopKeepAwakeStatus {
            supported: true,
            active: false,
            mode: "caffeinate".to_string(),
            detail: "keep-awake 보호를 종료했습니다.".to_string(),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Err("현재 플랫폼용 keep-awake 어댑터는 아직 구현되지 않았습니다.".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopKeepAwakeState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop_shell_status,
            desktop_download_file,
            desktop_keep_awake_status,
            desktop_keep_awake_start,
            desktop_keep_awake_stop,
            recorder_store::desktop_recorder_store_status,
            recorder_store::desktop_recorder_store_runtime,
            recorder_store::desktop_recorder_store_session,
            recorder_store::desktop_recorder_clear_runtime
        ])
        .run(tauri::generate_context!())
        .expect("error while running mystt desktop");
}
