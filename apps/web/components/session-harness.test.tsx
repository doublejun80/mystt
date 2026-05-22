import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SessionHarness } from "./session-harness";

describe("SessionHarness", () => {
  it("starts with recent history collapsed", () => {
    vi.stubGlobal("React", React);

    const markup = renderToStaticMarkup(
      <SessionHarness initialSessions={[]} reviewOnly />
    );

    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).toContain("펼치기");
    expect(markup).not.toContain("제목, 프로젝트, 상태로 찾기");
  });
});
