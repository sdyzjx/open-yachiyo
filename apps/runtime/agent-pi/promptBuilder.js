const { canReadLongTermMemory } = require('../security/sessionPermissionPolicy');

// Keep these policy paragraphs equivalent to the legacy loop.
function shouldHintPersonaTool(input) {
  const text = String(input || '').toLowerCase();
  if (!text.trim()) return false;
  const keywords = ['修改人格', '人格', '称呼', '叫我', 'persona', 'nickname', 'custom name'];
  return keywords.some((kw) => text.includes(kw));
}


function buildVoiceAutoReplyPrompt(runtimeContext = {}) {
  if (runtimeContext?.voice_auto_reply_enabled !== true) return null;
  if (runtimeContext?.voice_auto_reply_mode === 'force_on') {
    return [
      'Voice auto-reply force mode is enabled for this session.',
      'For every user-facing assistant reply with non-empty text, you MUST call voice.tts_aliyun_vc in the same turn before returning the final answer.',
      'The TTS tool call MUST be the first assistant action of the turn, before any Live2D, search, capture, or other tool call.',
      'Speak a concise useful reply immediately. If the request needs more tools or research, first speak a brief acknowledgement of what you will do, then continue the work after TTS succeeds.',
      'Do not skip the TTS call even for short replies.',
      'For voice.tts_aliyun_vc args, use text/voiceTag only; do not use durationSec or duration_sec.',
      'Voice text constraints: plain text only, no markdown, no code block, and no more than 5 sentences.'
    ].join(' ');
  }
  return [
    'Voice auto-reply mode is enabled for this turn.',
    `The current user input type is ${runtimeContext?.input_type === 'audio' ? 'audio' : 'text'}.`,
    'Decide whether speech improves this reply. Give high priority to audio input, short conversational answers, greetings, confirmations, and emotional responses; avoid speech for code, tables, link-heavy content, or detailed troubleshooting.',
    'If speech is appropriate, voice.tts_aliyun_vc MUST be the first assistant action, before any Live2D, search, capture, other tool call, or final text.',
    'Do not wait for the full written answer. Speak the direct short answer immediately, or speak a brief acknowledgement first when more tools or research are required, then continue after TTS succeeds.',
    'For voice.tts_aliyun_vc args, use text/voiceTag only; do not use durationSec or duration_sec.',
    'Voice text constraints: plain text only, no markdown, no code block, and no more than 5 sentences.'
  ].join(' ');
}


function buildDesktopCapturePrompt(availableTools = []) {
  const toolNames = new Set(
    (Array.isArray(availableTools) ? availableTools : [])
      .map((tool) => String(tool?.originalName || tool?.name || '').trim())
      .filter(Boolean)
  );
  const hasLocateTool = toolNames.has('desktop.locate.capture') || toolNames.has('desktop.locate.desktop');
  if (
    !toolNames.has('desktop.capture.screen')
    && !toolNames.has('desktop.capture.region')
    && !toolNames.has('desktop.capture.window')
    && !toolNames.has('desktop.capture.desktop')
  ) {
    return null;
  }
  return [
    'Desktop capture tools are available for this turn.',
    'When the user asks about current desktop, screen, UI, dialog, window, button, error, or any visible on-screen state, you MUST first call an appropriate desktop.capture.* tool before answering.',
    'Use desktop.capture.screen for one display, desktop.capture.region for a specific area, desktop.capture.window for one window, and desktop.capture.desktop for the full virtual desktop.',
    'After a desktop.capture.* tool succeeds, the loop will attach the screenshot in the next turn. Analyze that attached screenshot directly instead of guessing.',
    hasLocateTool
      ? 'When you need the position of an icon, button, text block, or other on-screen target, prefer desktop.locate.* tools. Use the returned display_id and display_relative_bounds directly instead of manually estimating desktop.capture.region coordinates.'
      : 'Do not manually guess region coordinates from screenshots unless they are explicitly known from prior tool output.',
    'If desktop.capture.region includes display_id, then x/y/width/height are relative to that display and must fit within that display bounds.',
    'If desktop.capture.region omits display_id, then x/y/width/height are global desktop coordinates and must stay within the target capture or virtual desktop bounds.',
    'Do not answer desktop-visibility questions without first capturing a screenshot.'
  ].join(' ');
}


function basePrompt(toolErrorMaxRetries = 5) {
  return [
            'You are a runtime planner that can either return a final answer or call tools.',
            'If tools are needed, you may emit one or more tool calls and wait for results in the next turn.',
            'Long-term memory operations must go through tools (memory_write / memory_search).',
            'For every reply turn, decide one Live2D action and a duration_sec based on the chat context.',
            'When live2d tools are available, call exactly one live2d.* tool with valid preset/action names and explicit duration_sec before final text response.',
            'When user asks to modify persona/addressing/custom title (e.g. 修改人格/修改称呼/叫我xxx), call persona.update_profile with {custom_name}.',
            'For requests that mention named targets (e.g. playlist/file/tab), avoid assuming exact names: first list/search candidates via tools, then choose the best semantic match before action.',
            'Tool approvals are handled by the runtime policy layer. Never request, forge, or retry an approval token yourself.',
            `If a tool returns an error, use the error details to re-plan and retry with an alternative approach. Maximum tool-error retries per run: ${toolErrorMaxRetries}.`,
            'Use persona.update_profile even in low permission sessions; this is globally allowed.',
            'Keep answers concise.'
  ].join(' ');
}

async function buildPrompt({ personaContextBuilder, resolvePersonaContext, resolveSkillsContext, sessionId, input,
  seedMessages = [], runtimeContext = {}, tools = [], toolErrorMaxRetries = 5 }) {
  const persona = resolvePersonaContext
    ? await resolvePersonaContext({ sessionId, input })
    : await personaContextBuilder?.build({ sessionId, input });
  const skills = await resolveSkillsContext?.({ sessionId, input });
  const allowMemory = canReadLongTermMemory(runtimeContext.permission_level);
  const seeds = seedMessages.filter((message) => message.role === 'system' && typeof message.content === 'string')
    .filter((message) => allowMemory || !/Long-term memory SOP|Bootstrap long-term memory/i.test(message.content));
  const sections = [
    basePrompt(toolErrorMaxRetries), persona?.prompt, skills?.prompt,
    shouldHintPersonaTool(input) ? 'User intent likely about persona/addressing. Prefer persona.update_profile tool call with {custom_name}.' : null,
    buildVoiceAutoReplyPrompt(runtimeContext), buildDesktopCapturePrompt(tools),
    ...seeds.map((message) => message.content),
    `Session permission level: ${runtimeContext.permission_level || 'medium'}. Tool permission checks remain authoritative.`,
    `Session approval mode: ${runtimeContext.approval_mode || 'manual'}. Approval decisions remain outside the model.`,
    allowMemory ? null : 'Long-term memory access is disabled for this low permission session.'
  ].filter(Boolean);
  return { systemPrompt: sections.join('\n\n'), persona, skills };
}

module.exports = { buildPrompt, basePrompt, buildVoiceAutoReplyPrompt, buildDesktopCapturePrompt };
