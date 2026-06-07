local job = CAPTION_JOB or {}

local function fail(message)
  print("ERROR: " .. tostring(message))
  os.exit(1)
end

local function get_resolve()
  if Resolve then return Resolve() end
  if resolve then return resolve end
  return nil
end

local function get_context()
  local r = get_resolve()
  if not r then fail("Resolve scripting is unavailable.") end
  local pm = r:GetProjectManager()
  if not pm then fail("Project manager unavailable.") end
  local project = pm:GetCurrentProject()
  if not project then fail("Open a Resolve project first.") end
  local timeline = project:GetCurrentTimeline()
  if not timeline then fail("Open a timeline before creating native captions.") end
  local mp = project:GetMediaPool()
  if not mp then fail("Media Pool unavailable.") end
  return project, timeline, mp
end

local function clip_name(clip)
  local ok, props = pcall(function() return clip:GetClipProperty() end)
  if ok and props then
    return props["Clip Name"] or props["File Name"] or props["Name"] or ""
  end
  return ""
end

local function find_template(folder, name)
  if not folder then return nil end
  local clips = folder:GetClipList() or {}
  for _, clip in ipairs(clips) do
    if clip_name(clip) == name then return clip end
  end
  local folders = folder:GetSubFolderList() or {}
  for _, child in ipairs(folders) do
    local found = find_template(child, name)
    if found then return found end
  end
  return nil
end

local function set_text(item, text)
  if not item then return false end
  local comp = nil
  pcall(function() comp = item:GetFusionCompByIndex(1) end)
  if not comp then return false end
  local tools = nil
  pcall(function() tools = comp:GetToolList(false, "TextPlus") end)
  if not tools then
    pcall(function() tools = comp:GetToolList(false, "Text3D") end)
  end
  if not tools then return false end
  for _, tool in pairs(tools) do
    local ok = pcall(function() tool:SetInput("StyledText", tostring(text or "")) end)
    if ok then return true end
  end
  return false
end

local function add_marker(item, text)
  if not item then return end
  pcall(function()
    item:AddMarker(0, "Cyan", "Resolve AI Caption", tostring(text or ""), 1)
  end)
end

local function main()
  local project, timeline, mp = get_context()
  local fps = tonumber(job.fps or project:GetSetting("timelineFrameRate") or 25) or 25
  local template_name = tostring(job.templateName or "Resolve AI Caption")
  local track_name = tostring(job.trackName or "Resolve AI Captions")
  local cues = job.cues or {}
  if #cues == 0 then fail("No caption cues provided.") end

  local root = mp:GetRootFolder()
  local template = find_template(root, template_name)
  if not template then fail("Caption template not found in Media Pool: " .. template_name) end

  pcall(function() timeline:AddTrack("video") end)
  local track_count = tonumber(timeline:GetTrackCount("video") or 1) or 1
  pcall(function() timeline:SetTrackName("video", track_count, track_name) end)

  local created = 0
  for _, cue in ipairs(cues) do
    local start_frame = math.max(0, math.floor((tonumber(cue.start) or 0) * fps + 0.5))
    local end_frame = math.max(start_frame + 1, math.floor((tonumber(cue["end"]) or 0) * fps + 0.5))
    local added = mp:AppendToTimeline({ {
      mediaPoolItem = template,
      startFrame = 0,
      endFrame = end_frame - start_frame,
      trackIndex = track_count,
      recordFrame = start_frame
    } })
    local item = added and added[1] or nil
    if item then
      set_text(item, cue.text or "")
      add_marker(item, cue.text or "")
      created = created + 1
    end
  end

  print("OK: created " .. tostring(created) .. " native captions")
end

main()
