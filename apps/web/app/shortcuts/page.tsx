const shortcutFiles = [
  {
    href: "/shortcuts/MYSTT_RECORDING_START.shortcut",
    title: "MYSTT_RECORDING_START",
    description: "방해금지 집중 모드를 켭니다."
  },
  {
    href: "/shortcuts/MYSTT_RECORDING_STOP.shortcut",
    title: "MYSTT_RECORDING_STOP",
    description: "방해금지 집중 모드를 끕니다."
  }
];

export default function ShortcutsInstallPage() {
  return (
    <main className="authShell">
      <section className="authPanel shortcutsInstallPanel">
        <p className="sectionEyebrow">mystt iPhone setup</p>
        <h1 className="pageTitle">단축어 다시 설치</h1>
        <p className="pageHeaderCopy">
          기존 MYSTT 단축어를 지운 뒤 아래 두 개를 iPhone에서 순서대로 열어 추가하세요.
        </p>

        <div className="shortcutInstallList">
          {shortcutFiles.map((shortcut) => (
            <a key={shortcut.href} className="shortcutInstallCard" href={shortcut.href}>
              <strong>{shortcut.title}</strong>
              <span>{shortcut.description}</span>
            </a>
          ))}
        </div>

        <p className="settingHint">
          추가 후 이름을 바꾸지 마세요. 웹 버튼은 이 두 이름을 정확히 호출합니다.
        </p>
      </section>
    </main>
  );
}
