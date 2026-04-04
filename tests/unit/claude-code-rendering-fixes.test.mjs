import test from "node:test";
import assert from "node:assert/strict";

const { openaiResponsesToOpenAIResponse } =
  await import("../../open-sse/translator/response/openai-responses.ts");
const { FORMATS } = await import("../../open-sse/translator/formats.ts");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.ts");
const { parseSSEToOpenAIResponse } = await import("../../open-sse/handlers/sseParser.ts");

test("Responses->Chat: output_item.done emits arguments when no delta chunks were sent", () => {
  const state = {
    started: true,
    chatId: "chatcmpl-test",
    created: 1234567890,
    toolCallIndex: 0,
    finishReasonSent: false,
    currentToolCallId: "call_abc",
    currentToolCallArgsBuffer: "",
  };

  const chunk = {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: "call_abc",
      name: "search_tasks",
      status: "completed",
      arguments: '{"query":"select:TaskCreate,TaskUpdate","max_results":10}',
    },
  };

  const result = openaiResponsesToOpenAIResponse(chunk, state);

  assert.ok(result);
  assert.equal(
    result.choices[0].delta.tool_calls[0].function.arguments,
    '{"query":"select:TaskCreate,TaskUpdate","max_results":10}'
  );
  assert.equal(state.toolCallIndex, 1);
});

test("Responses->Chat: output_item.done does not re-emit arguments already streamed via deltas", () => {
  const state = {
    started: true,
    chatId: "chatcmpl-test",
    created: 1234567890,
    toolCallIndex: 0,
    finishReasonSent: false,
    currentToolCallId: "call_abc",
    currentToolCallArgsBuffer: '{"query":"search"}',
  };

  const chunk = {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: "call_abc",
      name: "search",
      status: "completed",
      arguments: '{"query":"search"}',
    },
  };

  const result = openaiResponsesToOpenAIResponse(chunk, state);

  assert.equal(result, null);
  assert.equal(state.toolCallIndex, 1);
});

test("Responses->Chat: empty-name tool call is deferred until done provides a valid name", () => {
  const state = {
    started: true,
    chatId: "chatcmpl-test",
    created: 1234567890,
    toolCallIndex: 0,
    finishReasonSent: false,
    currentToolCallArgsBuffer: "",
    currentToolCallDeferred: false,
  };

  const added = openaiResponsesToOpenAIResponse(
    {
      type: "response.output_item.added",
      item: { type: "function_call", call_id: "call_deferred", name: "   " },
    },
    state
  );
  assert.equal(added, null);

  const delta = openaiResponsesToOpenAIResponse(
    {
      type: "response.function_call_arguments.delta",
      delta: '{"query":"deferred"}',
    },
    state
  );
  assert.equal(delta, null);

  const done = openaiResponsesToOpenAIResponse(
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call_deferred",
        name: "search_tasks",
        arguments: '{"query":"deferred"}',
      },
    },
    state
  );

  assert.ok(done);
  assert.equal(done.choices[0].delta.tool_calls[0].function.name, "search_tasks");
  assert.equal(done.choices[0].delta.tool_calls[0].function.arguments, '{"query":"deferred"}');
});

test("Responses->Chat: empty-name tool call is dropped when done still has no valid name", () => {
  const state = {
    started: true,
    chatId: "chatcmpl-test",
    created: 1234567890,
    toolCallIndex: 0,
    finishReasonSent: false,
    currentToolCallArgsBuffer: "",
    currentToolCallDeferred: false,
  };

  openaiResponsesToOpenAIResponse(
    {
      type: "response.output_item.added",
      item: { type: "function_call", call_id: "call_empty", name: "" },
    },
    state
  );

  const done = openaiResponsesToOpenAIResponse(
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call_empty",
        name: " ",
        arguments: '{"ignored":true}',
      },
    },
    state
  );

  assert.equal(done, null);
  assert.equal(state.toolCallIndex, 0);
});

test("Responses->Claude: translated Claude SSE is not sanitized into empty OpenAI chunks", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.CLAUDE,
    "codex",
    null,
    null,
    "gpt-5.4",
    "conn-test",
    { messages: [{ role: "user", content: "hi" }] },
    null,
    null
  );

  const writer = stream.writable.getWriter();
  await writer.write(
    encoder.encode('data: {"type":"response.output_text.delta","delta":"hello"}\n\n')
  );
  await writer.write(
    encoder.encode(
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":3}}}\n\n'
    )
  );
  await writer.close();

  const reader = stream.readable.getReader();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();

  assert.match(output, /event: message_start/);
  assert.match(output, /event: content_block_start/);
  assert.match(output, /event: content_block_delta/);
  assert.match(output, /event: message_delta/);
  assert.match(output, /event: message_stop/);
  assert.doesNotMatch(output, /data: \{"object":"chat\.completion\.chunk"\}\n\n/);
});

test("Responses->Chat: stream completion summary preserves tool_calls and excludes raw arg deltas", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let completedPayload = null;

  const stream = createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.OPENAI,
    "codex",
    null,
    null,
    "gpt-5.4",
    "conn-test",
    { messages: [{ role: "user", content: "hi" }] },
    (payload) => {
      completedPayload = payload;
    },
    null
  );

  const writer = stream.writable.getWriter();
  await writer.write(
    encoder.encode(
      'data: {"type":"response.reasoning_summary_text.delta","delta":"**Exploring repository structure**","item_id":"rs_1","output_index":0,"summary_index":0}\n\n'
    )
  );
  await writer.write(
    encoder.encode(
      'data: {"type":"response.output_text.delta","delta":"我先快速梳理这个仓库。","item_id":"msg_1","output_index":1,"content_index":0}\n\n'
    )
  );
  await writer.write(
    encoder.encode(
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_repo","name":"Subagent","arguments":""}}\n\n'
    )
  );
  await writer.write(
    encoder.encode(
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_call_repo","output_index":0,"delta":"{\\"description\\":\\"梳理仓库结构\\"}"}\n\n'
    )
  );
  await writer.write(
    encoder.encode(
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":5}}}\n\n'
    )
  );
  await writer.close();

  const reader = stream.readable.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    decoder.decode(value, { stream: true });
  }
  decoder.decode();

  assert.ok(completedPayload);
  assert.equal(completedPayload.responseBody.choices[0].message.content, "我先快速梳理这个仓库。");
  assert.equal(
    completedPayload.responseBody.choices[0].message.reasoning_content,
    "**Exploring repository structure**"
  );
  assert.equal(completedPayload.responseBody.choices[0].message.tool_calls.length, 1);
  assert.equal(
    completedPayload.responseBody.choices[0].message.tool_calls[0].function.arguments,
    '{"description":"梳理仓库结构"}'
  );
  assert.equal(completedPayload.responseBody.choices[0].finish_reason, "tool_calls");
});

test("Responses->Chat: response.completed output backfills tool calls missing from incremental events", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let completedPayload = null;

  const stream = createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.OPENAI,
    "codex",
    null,
    null,
    "gpt-5.4",
    "conn-test",
    { messages: [{ role: "user", content: "hi" }] },
    (payload) => {
      completedPayload = payload;
    },
    null
  );

  const writer = stream.writable.getWriter();
  await writer.write(
    encoder.encode(
      'data: {"type":"response.output_text.delta","delta":"我再从实际代码实现层面补充一下。","item_id":"msg_1","output_index":0,"content_index":0}\n\n'
    )
  );
  await writer.write(
    encoder.encode(
      'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","model":"gpt-5.4","usage":{"input_tokens":12,"output_tokens":5},"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"我再从实际代码实现层面补充一下。"}]},{"type":"function_call","id":"fc_1","call_id":"call_readme","name":"ReadFile","arguments":"{\\"path\\":\\"/tmp/README.md\\"}"}]}}\n\n'
    )
  );
  await writer.close();

  const reader = stream.readable.getReader();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();

  const parsed = parseSSEToOpenAIResponse(output, "gpt-5.4");
  assert.ok(parsed);
  assert.equal(parsed.choices[0].finish_reason, "tool_calls");
  assert.equal(parsed.choices[0].message.content, "我再从实际代码实现层面补充一下。");
  assert.equal(parsed.choices[0].message.tool_calls.length, 1);
  assert.equal(parsed.choices[0].message.tool_calls[0].function.name, "ReadFile");
  assert.equal(
    parsed.choices[0].message.tool_calls[0].function.arguments,
    '{"path":"/tmp/README.md"}'
  );

  assert.ok(completedPayload);
  assert.equal(completedPayload.responseBody.choices[0].finish_reason, "tool_calls");
  assert.equal(completedPayload.responseBody.choices[0].message.tool_calls.length, 1);
});
