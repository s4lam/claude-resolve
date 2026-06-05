# Resolve AI Pro UI, Ograph, and Manim Plan

## Summary

Resolve AI should move from a crowded sidebar tool stack to a professional creator workspace. The redesign has three pillars:

- **Workspace UI**: a full product shell organized around what users are doing: creating, producing, and discovering clips.
- **Ograph**: a functional motion workflow graph, not decoration. It records and controls the path from prompt/assets to generated code, validation, render, and timeline import.
- **Manim Lab**: an optional advanced engine for math, diagram, technical, and educational animations. It is detected locally and sandboxed; normal HTML/React overlay generation remains the default.

Original repo evidence:

- No surviving `ograph` implementation existed in current files or git history.
- No Manim integration existed.
- The UI was React component based under `plugin/src/components`, with tool panels mounted through `Sidebar.jsx`.
- The app already had sessions, assets, render history, templates, AI Clip Finder, Rough Cut, captions, render settings, Claude/Codex provider plumbing, and local config storage.

Current implementation status:

- Workspace shell exists with Create, Produce, and Discover modes, a compact left rail, main canvas, and right inspector.
- Ograph exists as local JSON storage with IPC, preload API, tests, a searchable workbench, node inspector, session/action nodes, render-history/template bridges, automatic capture after successful renders, direct graph render, reveal, and Add at Playhead controls.
- Manim Lab exists with local CLI detection, safe starter scenes, prompt builder, source validation, guarded local MP4 render into Render History, reveal/Media Pool sync actions, and explicit Add at Playhead after render.
- Render reliability work exists with `ffmpeg-static` fallback, encoder probes, diagnostics UI, installer checks, and release package validation.
- Runtime QA exists in Settings > Diagnostics with automated checks for workspace/Ograph/Manim/render prerequisites plus manual Resolve verification steps.

Remaining gaps before calling this complete:

- Manual Runtime QA still needs to be executed inside DaVinci Resolve on Windows/macOS.
- Ograph render preset switching UI beyond using the current render settings.
- Real Resolve QA for Manim Add at Playhead behavior on Windows/macOS.
- Updated screenshots/GIFs showing the new shell, Ograph, and Manim Lab.

Assumption: **Ograph** means the old experimental visual overlay/object graph concept. This plan reintroduces it as a motion workflow graph.

## Product Direction

### New Workspace Model

Replace the current many-tab sidebar mental model with three persistent workspace modes:

1. **Create**
   - Prompt composer.
   - Motion type wizard.
   - Presets.
   - Assets.
   - Brand Kit.
   - Style locks.
   - Latest result preview.
   - Ograph access for the current generation.

2. **Produce**
   - Selected result inspector.
   - Validation warnings.
   - Render settings.
   - Render queue/history.
   - Timeline actions.
   - Captions.
   - Output package details.

3. **Discover**
   - AI Clip Finder.
   - Rough Cut.
   - Saved Shorts projects.
   - Prompt Gallery.
   - Template Library.

The layout should be:

- **Left rail**: workspace mode switcher and high-level project/session controls.
- **Primary canvas**: chat, preview, or graph depending on selected mode.
- **Right inspector**: context-aware details for selected result, asset, render, node, settings, or timeline item.
- **Bottom command bar**: prompt input and quick actions.

This is a structural redesign. It should not be implemented as small style tweaks to the existing sidebar.

## Ograph MVP

### Purpose

Ograph is the visible and editable workflow behind a generated motion graphic. A user should understand where a result came from, why it failed or succeeded, and what can be regenerated without starting over.

### Graph Nodes

MVP node types:

- `prompt`: original user prompt and generated system context.
- `provider`: Claude/Codex, model, effort, timestamp.
- `asset`: selected assets, paths, categories, notes.
- `brand`: Brand Kit values used.
- `generation`: generated HTML/React/Manim source.
- `validation`: duration, dimensions, transparency, render API checks.
- `render`: output file, preset, FFmpeg health, status.
- `timeline`: Resolve import/add-to-timeline result.
- `template`: saved template link.

### Graph Actions

Each node supports actions relevant to its type:

- Prompt: edit prompt, regenerate.
- Asset: attach/detach asset, regenerate with asset locked.
- Brand: update Brand Kit, regenerate with brand locked.
- Generation: show code, save as template, make variation.
- Validation: fix with AI, explain warning.
- Render: re-render, switch preset, reveal file, copy diagnostics.
- Timeline: re-add to timeline, reveal render, sync history.

### Storage

Store graph files locally beside existing user data:

- Config folder remains the legacy `Claude Resolve` folder for compatibility.
- Suggested directory: `<config>/ographs/`.
- One graph per meaningful generation/result.
- Sessions store `ographId` references so old chats can reopen the graph.

### Ograph Schema

MVP JSON:

```json
{
  "id": "ograph_...",
  "version": 1,
  "title": "Creator title card",
  "sessionId": "session_...",
  "resultId": "message_or_render_id",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "nodes": [
    {
      "id": "node_prompt",
      "type": "prompt",
      "label": "Prompt",
      "status": "ready",
      "data": {}
    }
  ],
  "edges": [
    {
      "from": "node_prompt",
      "to": "node_generation",
      "label": "generated"
    }
  ]
}
```

Node status values:

- `ready`
- `warning`
- `failed`
- `running`
- `skipped`

### IPC

Add:

- `ograph:list`
- `ograph:get`
- `ograph:save`
- `ograph:updateNode`
- `ograph:delete`
- `ograph:createFromGeneration`
- `ograph:createFromRender`
- `ograph:buildRegeneratePrompt`

Keep these internal and local-first. Do not add remote sync.

### UI

Add:

- `WorkspaceShell.jsx`
- `WorkspaceRail.jsx`
- `InspectorPanel.jsx`
- `OgraphView.jsx`
- `OgraphNodeInspector.jsx`

Ograph rendering should start with plain React + SVG:

- SVG edges.
- HTML node cards.
- Keyboard selectable nodes.
- Zoom-to-fit optional after MVP.

Do not add a heavy graph dependency in MVP unless the hand-built graph becomes too brittle.

## Manim Lab MVP

### Purpose

Manim Lab is for content where HTML overlays are the wrong tool:

- Math explainers.
- Technical diagrams.
- Algorithm visualizations.
- Educational Shorts.
- Clean geometric animations.
- Chart/graph transformations.

It should not replace normal title cards, lower thirds, logo reveals, or transparent motion graphics.

### Detection

Add local detection:

- Python executable.
- `manim` CLI.
- Manim version.
- FFmpeg availability from existing render health.
- Optional LaTeX availability, shown as warning only.

If missing, show setup guidance. Do not block the rest of Resolve AI.

### Safety

Manim generation runs only in a temporary project folder.

MVP restrictions:

- One generated `.py` scene file.
- One scene class.
- Allowlist imports from `manim` and Python standard math/data modules only.
- Reject code using `os`, `sys`, `subprocess`, `socket`, `shutil`, `pathlib.Path.unlink`, `open`, `eval`, `exec`, or network/file deletion patterns.
- No arbitrary Python execution UI.
- Do not let users paste arbitrary Python into a terminal-like runner.

### Render Flow

1. User chooses **Create > Technical / Manim Lab**.
2. App checks Manim health.
3. AI returns a complete Manim scene file plus metadata.
4. App validates source with the safety rules.
5. App renders with Manim CLI into a temp media folder.
6. App copies or converts output into existing render history.
7. App can add the result to timeline like other renders.
8. Ograph records prompt, Manim source, validation, render output, and timeline import nodes.

### IPC

Add:

- `manim:health`
- `manim:buildPrompt`
- `manim:validateSource`
- `manim:render`
- `manim:getLastError`

### UI

Add Manim Lab as an engine choice in Create:

- `HTML Overlay` default.
- `React Overlay` if supported by current generation path.
- `Manim Lab` optional advanced mode.

Manim Lab UI shows:

- install status,
- scene prompt,
- dimensions/FPS/duration,
- quality target,
- source preview,
- render status,
- output preview,
- Ograph link.

## Implementation Phases

### Phase 1: Workspace Shell

Goal: create the new UI structure without removing existing features.

Work:

- Add `WorkspaceShell`.
- Add left rail modes: Create, Produce, Discover.
- Move existing `Sidebar` tools into mode-specific panels.
- Add right inspector shell.
- Keep current Chat and Preview working.
- Keep Settings accessible from rail and command bar.
- Persist active workspace mode in `config.ui.activeWorkspaceMode`.

Acceptance:

- Existing tools remain reachable.
- Narrow Resolve plugin width has no clipped controls.
- Chat/send/render still works.
- `npm --prefix plugin run smoke` checks workspace mode labels.

### Phase 2: Inspector System

Goal: make selection/context visible and reduce crowded panels.

Work:

- Add selected object state: result, asset, render, template, graph node.
- Add inspector sections for result metadata, render settings, asset details, and validation.
- Move diagnostics-heavy content out of the main tool panel and into inspector sections.

Acceptance:

- Clicking a render/result/asset changes inspector.
- Settings no longer needs to carry every advanced panel in one long scroll.
- Keyboard focus order remains predictable.

### Phase 3: Ograph Core

Goal: create, store, render, and reopen graphs.

Work:

- Add Ograph IPC/storage/schema validation.
- Auto-create Ograph for new generated cards.
- Auto-attach validation/render/timeline nodes as events happen.
- Add Ograph canvas and node inspector.

Acceptance:

- Generate result -> graph appears.
- Render result -> render node updates.
- Reopen session -> graph restores.
- Delete graph -> session handles missing graph gracefully.

### Phase 4: Ograph Actions

Goal: graph becomes functional.

Work:

- Regenerate from prompt/generation/asset/brand nodes.
- Fix from validation/render nodes.
- Save graph output as template.
- Re-render from render node.
- Persist action nodes when users draft an Ograph action.
- Capture active session context when creating a graph from the latest generation.
- Render a graph directly from its generated HTML and update render/timeline nodes.
- Reveal a linked render file and add a linked render at the playhead.

Acceptance:

- User can regenerate from a selected graph node without rewriting the prompt.
- Failed render node can generate a repair prompt.
- Ograph action results are appended back into the graph.
- Captured graphs show source session metadata when available.
- Ograph can render a graph and write the resulting render/timeline state back into the graph.

### Phase 5: Manim Health + Prompting

Goal: Manim is discoverable and safe before rendering.

Work:

- Add Manim detection IPC.
- Add Manim prompt builder.
- Add Manim source validator.
- Add tests for unsafe code rejection.
- Add safe starter scenes for common explainer/diagram use cases.

Acceptance:

- Missing Manim shows clear setup state.
- Valid simple scene passes validation.
- Unsafe generated source is blocked.
- Built-in starter scenes validate with the same backend validator.

### Phase 6: Manim Render MVP

Goal: render a simple generated Manim scene into Resolve AI history.

Work:

- Render in temp project folder.
- Capture stdout/stderr and friendly errors.
- Copy output into render history.
- Add Ograph Manim nodes.
- Reveal rendered MP4, add it at the playhead, and sync render history to the Media Pool from Manim Lab.

Acceptance:

- A simple geometry/diagram prompt renders locally when Manim is installed.
- Missing LaTeX shows useful warning for text-heavy scenes.
- Existing HTML render flow is unaffected.
- Rendered Manim result has reveal, Add at Playhead, and Media Pool sync handoff actions.

### Phase 7: Polish + Release Prep

Goal: make it feel like a serious public fork feature.

Work:

- README section with screenshots/GIF targets.
- Short demo prompts.
- Troubleshooting for Ograph and Manim.
- Release ZIP validation includes new IPC/components.
- Smoke test covers workspace modes and Ograph entry point.

Acceptance:

- Build/package passes.
- Manual Resolve smoke works on Windows.
- macOS paths remain platform-safe.

## Test Plan

Automated:

- Workspace mode persistence.
- Ograph schema validation.
- Ograph save/list/get/update/delete.
- Ograph create from generated result.
- Ograph create from render metadata.
- Ograph regenerate prompt construction.
- Manim health detection with missing/available command mocks.
- Manim source validation safe/unsafe fixtures.
- Manim render command construction.
- Existing provider/render/session/tests remain green.

Commands:

```bash
npm --prefix plugin test
npm --prefix plugin run build
npm --prefix plugin run smoke
npm --prefix plugin run package:release
git diff --check
```

Manual:

- Generate title card, inspect graph, render, verify render node updates.
- Attach logo, verify asset node appears.
- Save as template, verify template node appears.
- Trigger validation warning, verify warning node and Fix with AI action.
- Manim missing: setup state only, no crash.
- Manim installed: render simple geometry scene.
- Narrow plugin window: no clipped Ograph/inspector/command bar.

## Defaults

- Default engine: HTML Overlay.
- Manim Lab: optional advanced mode.
- Ograph: enabled by default for new generations.
- Old sessions without graphs: still open normally.
- Storage: local only.
- No cloud sync.
- No direct arbitrary Python runner.
- No dependency on Manim for install success.

## First PR Recommendation

Start with **Phase 1 + Phase 2 only**:

- Workspace shell.
- Inspector shell.
- Existing tools moved into Create/Produce/Discover.
- No Ograph storage yet.
- No Manim yet.

Reason: Ograph and Manim need a better layout to live in. Building them inside the current crowded sidebar would preserve the wrong product shape.
