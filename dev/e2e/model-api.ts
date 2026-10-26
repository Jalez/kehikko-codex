// A stand-in for the model API (OpenAI Responses), recording every request to $STANDIN_LOG.
// It is scripted by the last thing the person typed:
//   RUN: <cmd>   answer with an exec_command call (sandboxed)
//   ESC: <cmd>   the same, asking to run unsandboxed (an approval question)
//   SLOW <n> ... wait n seconds before answering (a turn under way)
//   $<skill> <words>  run the skill's first fenced sh command, unsandboxed (reading its file first if need be)
// After a tool's output comes back it answers with one line quoting it. Usage grows with the
// request (input/4 tokens, times STANDIN_SCALE), so a context meter moves.
import { appendFileSync } from "node:fs";
const port = Number(process.env.STANDIN_PORT ?? 18555);
const log = process.env.STANDIN_LOG ?? "requests.jsonl";
const scale = Number(process.env.STANDIN_SCALE ?? 1);
let n = 0;
const lastUserText = (input: any[]): string => {
  for (let i = input.length - 1; i >= 0; i--) {
    const it = input[i];
    if (it?.type === "message" && it.role === "user") {
      const t = (it.content ?? []).map((c: any) => c.text ?? "").join("\n");
      if (!t.startsWith("<environment_context>") && !t.startsWith("<skill")) return t;
    }
  }
  return "";
};
Bun.serve({
  port, hostname: "127.0.0.1", idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const text = req.method === "POST" ? await req.text() : "";
    let body: any = null; try { body = JSON.parse(text); } catch {}
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, body }) + "\n");
    if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "gpt-5.5", object: "model" }], models: [] });
    if (!url.pathname.includes("/responses")) return new Response("not here", { status: 404 });
    n++;
    const input: any[] = Array.isArray(body?.input) ? body.input : [];
    const last = input[input.length - 1];
    const said = lastUserText(input);
    const input_tokens = Math.round((JSON.stringify(input).length / 4) * scale);
    const usage = { input_tokens, input_tokens_details: { cached_tokens: Math.round(input_tokens / 2) }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: input_tokens + 20 };
    if (url.pathname.endsWith("/compact")) {
      return Response.json({ id: `resp_${n}`, output: [{ type: "message", role: "user", content: [{ type: "input_text", text: "stand-in summary of the conversation" }] }], usage });
    }
    let at = -1;
    for (let i = input.length - 1; i >= 0; i--) { const it = input[i]; if (it?.type === "message" && it.role === "user" && !String(it.content?.[0]?.text ?? "").startsWith("<environment_context>") && !String(it.content?.[0]?.text ?? "").startsWith("<skill")) { at = i; break; } }
    const answered = input.slice(at + 1).find((it: any) => it?.type === "function_call_output");
    const slow = /^SLOW (\d+)/.exec(said);
    if (slow && !answered) await Bun.sleep(Number(slow[1]) * 1000);
    let item: any;
    const run = /^(RUN|ESC): (.+)$/s.exec(said);
    /* `$name words`: do what the skill says, as a model would — its first fenced sh command, outside
       the sandbox, with SAY replaced by the words; reading the skill's file first when Codex gave
       only its path. */
    const invoked = /^\$([a-z][a-z0-9-]*)\b ?(.*)$/s.exec(said);
    const outputs = input.slice(at + 1).filter((it: any) => it?.type === "function_call_output").map((it: any) => String(typeof it.output === "string" ? it.output : JSON.stringify(it.output)));
    const pool = [...input.flatMap((it: any) => (it?.type === "message" ? [it] : [])).flatMap((it: any) => (it?.content ?? []).map((c: any) => String(c.text ?? ""))), ...outputs].join("\n");
    let skillCall: any = null;
    if (invoked) {
      const name = invoked[1]!;
      const at2 = pool.lastIndexOf(`name: ${name}`);
      const body = at2 >= 0 ? pool.slice(at2) : "";
      const sh = /```sh\n([\s\S]*?)\n\s*```/.exec(body)?.[1]?.split("\n").map((line) => line.trim()).join("\n").trim();
      const ranIt = outputs.some((one) => one.includes("curl exit") || one.includes("Kehikot:"));
      if (sh && !ranIt) skillCall = { cmd: sh.replace("'say=SAY'", `'say=${invoked[2]!.trim()}'`), sandbox_permissions: "require_escalated", justification: "Tell Kehikot on this computer which conversation this is" };
      else if (!sh && !outputs.length) {
        const file = new RegExp(`${name}[^\\n]*?\\(file: ([^)]+SKILL\\.md)\\)`).exec(pool)?.[1];
        if (file) skillCall = { cmd: `cat '${file}'` };
      }
    }
    if (skillCall) {
      item = { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: "exec_command", arguments: JSON.stringify(skillCall), status: "completed" };
    } else if (run && !answered) {
      const args: any = { cmd: run[2].trim() };
      if (run[1] === "ESC") { args.sandbox_permissions = "require_escalated"; args.justification = "Stand-in asks to run this outside the sandbox."; }
      item = { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: "exec_command", arguments: JSON.stringify(args), status: "completed" };
    } else {
      const lastOut = outputs.length ? outputs[outputs.length - 1] : answered ? String(typeof answered.output === "string" ? answered.output : JSON.stringify(answered.output)) : null;
      const out = lastOut !== null ? `ran: ${lastOut.slice(0, 300)}` : (process.env.STANDIN_SAY ?? `stand-in reply ${n}`);
      item = { type: "message", id: `msg_${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: out, annotations: [] }] };
    }
    const id = `resp_${n}`;
    const events: [string, any][] = [["response.created", { type: "response.created", response: { id, status: "in_progress" } }]];
    events.push(["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", ...(item.type === "message" ? { content: [] } : {}) } }]);
    if (item.type === "message") events.push(["response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text }]);
    events.push(["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }]);
    events.push(["response.completed", { type: "response.completed", response: { id, status: "completed", output: [item], usage } }]);
    return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  },
});
console.log(`stand-in on ${port}`);
