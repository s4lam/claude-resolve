local job = CAPTION_JOB or {}

local function fail(message)
    print("ERROR: " .. tostring(message or "Native Text+ failed."))
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
    local project = r:GetProjectManager():GetCurrentProject()
    if not project then fail("Open a Resolve project first.") end
    local timeline = project:GetCurrentTimeline()
    if not timeline then fail("Open a timeline before creating native captions.") end
    local media_pool = project:GetMediaPool()
    if not media_pool then fail("Media Pool is unavailable.") end
    return project, timeline, media_pool
end

local function file_exists(file_path)
    if not file_path or tostring(file_path) == "" then return false end
    local f = io.open(file_path, "rb")
    if f then f:close() return true end
    return false
end

local function clip_name(clip)
    if not clip then return "" end
    local name = nil
    pcall(function() name = clip:GetName() end)
    if name and tostring(name) ~= "" then return tostring(name) end
    local props = nil
    pcall(function() props = clip:GetClipProperty() end)
    if type(props) == "table" then
        return tostring(props["Clip Name"] or props["File Name"] or props["Name"] or "")
    end
    return ""
end

local function find_template_in_folder(folder, template_name)
    if not folder then return nil end
    local clips = {}
    pcall(function() clips = folder:GetClipList() or {} end)
    for _, clip in ipairs(clips) do
        if clip_name(clip) == template_name then return clip end
    end
    local subs = {}
    pcall(function() subs = folder:GetSubFolderList() or {} end)
    for _, sub in ipairs(subs) do
        local found = find_template_in_folder(sub, template_name)
        if found then return found end
    end
    return nil
end

local function find_template(media_pool, template_name)
    local current = nil
    pcall(function() current = media_pool:GetCurrentFolder() end)
    local found = find_template_in_folder(current, template_name)
    if found then return found end
    local root = nil
    pcall(function() root = media_pool:GetRootFolder() end)
    return find_template_in_folder(root, template_name)
end

local function import_template_bundle(media_pool, template_drb_path)
    if not file_exists(template_drb_path) then return false end
    local ok, result = pcall(function() return media_pool:ImportFolderFromFile(template_drb_path) end)
    return ok and result ~= false
end

local function set_text(item, text)
    if not item then return false end
    local comp = nil
    pcall(function() comp = item:GetFusionCompByIndex(1) end)
    if not comp then
        pcall(function() item:AddFusionComp() end)
        pcall(function() comp = item:GetFusionCompByIndex(1) end)
    end
    if not comp then return false end

    local tools = nil
    pcall(function() tools = comp:GetToolList(false, "TextPlus") end)
    if not tools then
        pcall(function() tools = comp:GetToolList(false, "Text3D") end)
    end
    if not tools then return false end

    for _, tool in pairs(tools) do
        local ok = pcall(function()
            tool.StyledText = tostring(text or "")
            if tool.SetInput then tool:SetInput("StyledText", tostring(text or "")) end
        end)
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

local function timecode_to_frame(tc, fps)
    local h, m, s, f = tostring(tc or "00:00:00:00"):match("(%d+):(%d+):(%d+)[:;](%d+)")
    if not h then return 0 end
    return ((tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(s)) * fps) + tonumber(f)
end

local function load_cues_from_text(raw)
    local cues = {}
    for line in tostring(raw or ""):gmatch("[^\r\n]+") do
        local start_s, end_s, text = line:match("^([^\t]+)\t([^\t]+)\t(.*)$")
        if start_s and end_s and text then
            local start_v = tonumber(start_s) or 0
            local end_v = tonumber(end_s) or (start_v + 1)
            if end_v > start_v and text ~= "" then
                table.insert(cues, { start = start_v, ["end"] = end_v, text = text })
            end
        end
    end
    return cues
end

local function load_cues_from_file(file_path)
    if not file_path or tostring(file_path) == "" then return {} end
    local f = io.open(file_path, "r")
    if not f then return {} end
    local raw = f:read("*a") or ""
    f:close()
    return load_cues_from_text(raw)
end

local function cue_list()
    local cues = {}
    if CAPTION_NATIVE_CUES then cues = CAPTION_NATIVE_CUES end
    if #cues == 0 and CAPTION_CUE_ROWS and tostring(CAPTION_CUE_ROWS) ~= "" then
        cues = load_cues_from_text(CAPTION_CUE_ROWS)
        print("INFO: loaded " .. tostring(#cues) .. " native caption cues from embedded rows")
    end
    if #cues == 0 then
        local cue_file = job.cueFile or CAPTION_CUE_FILE
        cues = load_cues_from_file(cue_file)
        if #cues > 0 then print("INFO: loaded native caption cues from file " .. tostring(cue_file)) end
    end
    return cues
end

local function append_template_item(media_pool, template_item, track_index, record_frame, duration_frames)
    local appended = nil
    local ok = pcall(function()
        appended = media_pool:AppendToTimeline({{
            mediaPoolItem = template_item,
            startFrame = 0,
            endFrame = duration_frames,
            recordFrame = record_frame,
            trackIndex = track_index,
            mediaType = 1
        }})
    end)
    if not ok or not appended then return nil end
    if type(appended) == "table" then return appended[1] end
    return appended
end

local function main()
    local project, timeline, media_pool = get_context()
    local expected_bridge = tostring(job.bridgeVersion or "")
    local actual_bridge = "native-text-template-append-v1"
    print("INFO: native bridge " .. actual_bridge)
    if expected_bridge ~= "" and expected_bridge ~= actual_bridge then
        print("WARN: Bridge mismatch: cueCount was " .. tostring(job.cueCount or 0) .. ", expected " .. expected_bridge .. ", loaded " .. actual_bridge)
    else
        print("INFO: Bridge mismatch: cueCount was " .. tostring(job.cueCount or 0) .. " checked")
    end

    local fps = tonumber(job.fps or project:GetSetting("timelineFrameRate") or 25) or 25
    local template_name = tostring(job.templateName or "Resolve AI Caption")
    local track_name = tostring(job.trackName or "Resolve AI Captions")
    local template_drb_path = tostring(job.templateDrbPath or job.templateAssetPath or "")
    local template_item = find_template(media_pool, template_name)

    if not template_item and import_template_bundle(media_pool, template_drb_path) then
        print("INFO: imported native Text+ template bundle " .. template_drb_path)
        template_item = find_template(media_pool, template_name)
    end

    if job.setupOnly then
        if template_item then
            print("OK: template setup ready")
            return
        end
        fail("Caption template not found. Create or import a Text+ title/generator in the Media Pool and name it " .. template_name .. ".")
    end

    if not template_item then
        fail("Caption template not found. Create or import a Text+ title/generator in the Media Pool and name it " .. template_name .. ".")
    end

    local cues = cue_list()
    print("INFO: received " .. tostring(#cues) .. " native caption cues")
    if tonumber(job.cueCount or 0) > 0 and #cues ~= tonumber(job.cueCount) then
        print("WARN: Bridge mismatch: cueCount was " .. tostring(job.cueCount) .. ", Lua received " .. tostring(#cues))
    end
    if #cues == 0 then fail("No caption cues provided.") end

    pcall(function() timeline:AddTrack("video") end)
    local track_count = tonumber(timeline:GetTrackCount("video") or 1) or 1
    pcall(function() timeline:SetTrackName("video", track_count, track_name) end)

    local timeline_start = 0
    pcall(function() timeline_start = tonumber(timeline:GetStartFrame() or 0) or 0 end)
    local playhead_frame = nil
    pcall(function() playhead_frame = timecode_to_frame(timeline:GetCurrentTimecode(), fps) end)
    local base_record_frame = tonumber(job.recordFrame or playhead_frame or timeline_start or 0) or 0
    print("INFO: placing native captions at base frame " .. tostring(base_record_frame) .. " on video track " .. tostring(track_count))

    local created = 0
    local text_failed = 0
    for _, cue in ipairs(cues) do
        local start_frame = math.max(0, math.floor((tonumber(cue.start) or 0) * fps + 0.5))
        local end_frame = math.max(start_frame + 1, math.floor((tonumber(cue["end"]) or 0) * fps + 0.5))
        local duration_frames = math.max(1, end_frame - start_frame)
        local record_frame = base_record_frame + start_frame
        local item = append_template_item(media_pool, template_item, track_count, record_frame, duration_frames)
        if not item then
            fail("Resolve rejected AppendToTimeline for Text+ caption at frame " .. tostring(record_frame) .. ".")
        end
        if not set_text(item, cue.text or "") then text_failed = text_failed + 1 end
        add_marker(item, cue.text or "")
        created = created + 1
    end

    if text_failed > 0 then
        print("WARN: text update failed for " .. tostring(text_failed) .. " created captions")
    end
    print("OK: created " .. tostring(created) .. " native captions")
end

main()
