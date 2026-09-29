# Changes

## 0.3.1

All five packages move to 0.3.1 together.

### @ziffer-io/mcp

- Three guided flows, offered as MCP prompts: `setup_ziffer` takes you from installing ZIFFER to a receipt verified on your own machine, `scan_and_explain` scans your code for the tools it gives an AI model and names the one place to put ZIFFER, and `why_refused` takes a refusal, a rule, a decision or a receipt and says what it means, who fixes it and what to do now.
- Every tool answer ends with the next step, after the answer itself.
- `ZIFFER_API_URL` defaults to `https://api.ziffer.io`. When the API key, the trust anchor or the suite floor is missing, the answer says how to get it and which steps work without it. A service that does not answer is named, with three things to check.

### @ziffer-io/scan

- A folder is skipped for what it holds, never for its name alone: a tool kept in a folder named `build` or `test` is now found. A folder is skipped only on evidence, such as your `.gitignore`, a build output setting, or a test inside it, and the report says how many folders were not read and why.
- A model library your project declares but the scan does not read is named in the report, so its absence from the results is never mistaken for no tools.

### The ZIFFER plugin for Claude Code

- The setup skills follow the guided flows and end with the next step. The plugin starts `@ziffer-io/mcp@0.3.1`.

## 0.3.0

The first release published from this repository, built and published by its own pipeline with npm provenance.

### @ziffer-io/scan

- `--code` scans your application's own code for the tools it gives an AI model, in TypeScript and in Python, and grades what a model could reach through them.
- It recognises the tools of the common agent frameworks in both languages, among them the Claude Agent SDK, the OpenAI Agents SDK, Amazon Bedrock Converse, Mastra, Genkit, LlamaIndex, Haystack, Semantic Kernel, Google ADK, Strands Agents, smolagents, DSPy, AG2 and Microsoft Agent Framework, and VS Code language model tools.
- It follows a tool request from the model's reply to the function your application hands the tool's name and input, and treats that function as the one place a check can stand.
- It says where structured output is used and never counts it as a tool.
- It reads the skills and instruction files your application gives its model, says who loads each one and where its text goes, and checks the tools a skill names against the code.
- It reads instruction-like text in your own tool descriptions, lists the pairs of tools through which data could leave, and reports coding-assistant hook files as checks already in place.
- The report is redesigned: one grade for today and what is within reach, a first screen whose numbers add up, the policy as a checklist, and a technical part that opens on what the scan did not read. Both reports carry their own fonts and load nothing.
- Excessive Agency is cited as LLM03:2026, the current OWASP edition.

### @ziffer-io/mcp

- `check_policy_repo` compares every workflow the policy template ships against your repository.

### The ZIFFER plugin for Claude Code

- New: the ZIFFER tools and six setup skills (`start`, `scan`, `integrate`, `policy`, `pipeline`, `verify`), each a written procedure, with hard stops Claude may not cross.

### All packages

- The npm pages link to this repository.
