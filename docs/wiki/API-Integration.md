# API Integration

A screen is half of a frontend; the other half is the API it talks to. A project can pass every test and still call an endpoint that does not exist, send a field the API never had, or ignore the error the API documents.
Scaffolder treats the API's documentation the way it treats the design: as a **contract**, committed to the repository, that the agent builds from and that a check enforces.

> **What this gives you, and what it cannot.** You bring in the API's documentation (an OpenAPI or Swagger file, a Postman collection, a link, or a guide) next to your requirements document.
> The agent is shown it, every PRD must list the operations it calls, and the spec fails when one is not documented. It does **not** prove that the real API behaves as documented, and it does not read the code to find calls the PRD did not list: that stays a review.

## In five minutes

In a generated project that has a web or Flutter screen:

```bash
./scripts/sdlc api import openapi.yaml                    # 1. bring the API's documentation in (a file, or a link to one)
./scripts/sdlc spec requirements.pdf --api openapi.yaml   # 2. or draft the spec from the requirements AND the documentation together
./scripts/sdlc api check                                  # 3. the gate: every imported file is still as imported
```

Then read what the spec drafted (its **API integration** section lists each operation the feature calls), set `Status: Accepted`, and run `./scripts/sdlc implement FEAT-001`. The sections below explain each step.

## The three layers

| Layer | What it is | Who checks it |
|---|---|---|
| **The documentation** | `.ai/api/<name>/`: each imported document exactly as it was, a generated index of its operations, and `.ai/api/apis.json`, which records every file with its checksum. | The `repo.api` gate: files unchanged, indexes current |
| **The brief** | The PRD's **API integration** section: every operation the feature calls as `` `GET /path` ``, how requests are authenticated, what the user sees when each fails, how fields map to the screen. `No API calls.` is a complete one. | The spec check: a PRD without the section fails, and so does one that names an operation no imported document has |
| **The review** | A person reads the client against `./scripts/sdlc api show METHOD /path` for each operation. | A person (the skill `integrate-api` and the PR template say what to look at) |

A project with a screen (a web app, a Flutter app, or both) gets all three. A backend on its own has none: the API it serves is its contract in `.ai/contract/`.
A project with a backend **and** a screen already has its own API documented, and `api list` shows it as `backend`; import documentation only for the *other* APIs the screens call.

## What can be imported

```bash
./scripts/sdlc api import openapi.yaml                            # OpenAPI 3.x or Swagger 2.0, JSON or YAML
./scripts/sdlc api import https://api.example.com/openapi.json    # the same, from a link
./scripts/sdlc api import collection.json --name partner-api      # a Postman collection (v2.x)
./scripts/sdlc api import api-guide.pdf --name partner-guide      # a guide for people: .pdf, .docx, .md, .txt
```

| Source | What the tool learns | How exact | Notes |
|---|---|---|---|
| **OpenAPI 3.x / Swagger 2.0** | Every operation, its parameters, request body, documented responses, the types they use, the servers and the auth schemes | Exact: it is read from the document | A YAML document that uses anchors, aliases or tags is kept, but no index is built (the tool says so; convert it to JSON for the full benefit) |
| **Postman collection** | Each request's method, path and query, and the examples saved in it | Requests and examples, not types: a collection does not say what a field is | `api show` prints the example bodies |
| **A link** | The same as a file | A link to a documentation page is followed to `/openapi.json`, `/swagger.json`, `/v3/api-docs` and a few other usual places beside it | A link with a user name or password in it is refused (it would be written down), and the query string is never recorded. Download a protected document and import the file |
| **A guide** (PDF, Word, Markdown, text) | Nothing machine-readable: it is stored with its extracted text | PDF text is as good as the PDF's text layer | The PRD's operations cannot be checked against it, so any operation is accepted while a guide is the only documentation |

- **One name each.** The name comes from the document's title, or `--name`. Importing a name again replaces it and prints which operations were added and removed. `backend` is reserved for the project's own contract.
- **Limits.** 20 MB a file. Files are stored with LF line endings so their checksums are the same on every system.
- **Nothing is sent anywhere.** Importing a link fetches that link (and the few usual places beside it); no token is read, and nothing about the project is sent.

## Reading it

```bash
./scripts/sdlc api list                       # every documented operation, grouped by tag
./scripts/sdlc api list --grep order          # only the lines that mention "order"
./scripts/sdlc api show GET /pets/{petId}     # one operation with its parameters, body, responses and every type it uses
```

`show` prints, for example:

```text
GET /pet/{petId}   [pets]
Find pet by ID
operationId: getPetById   tags: pet
servers: https://petstore3.swagger.io/api/v3
auth: api_key or petstore_auth [write:pets]

Parameters
  petId   path   integer (int64)   required   ID of pet to return

Responses
  200   application/json   Pet   successful operation
  404   (no body)   Pet not found

Types
  Pet {
    id?: integer (int64)
    name: string
    category?: Category
    photoUrls: string[]
    status?: "available" | "pending" | "sold"   // pet status in the store
  }
```

A path with a real value (`/pet/1234`), one with the server's base path (`/api/v3/pet/{petId}`) and one written with another parameter name all find the same operation.
The agent is given the same index (and, for a long one, told to search it with `api list --grep` and read one operation with `api show` instead of the whole document).

## From requirements and an API to a verified screen

1. **Bring the API in.** `./scripts/sdlc api import ...`, or `./scripts/sdlc spec requirements.pdf --api openapi.yaml` (it imports first, then drafts). Commit `.ai/api/`: an agent may not change it, and `implement` wants a clean tree.
2. **Draft the spec.** `./scripts/sdlc spec requirements.pdf` gives the agent the requirements and the operation index. It must write the PRD's **API integration** section using only documented operations; a gap becomes an `ASSUMPTION:` and a question, never an invented endpoint.
   In the Claude desktop app, `/sdlc-spec requirements.pdf` does the same after you have run `api import` and committed it.
3. **Review the draft.** Compare the operations it lists with the requirements, confirm each `ASSUMPTION:`, set `Status: Accepted`.
4. **Build it.** `./scripts/sdlc implement FEAT-001`. The agent follows `.ai/skills/integrate-api/` and `.ai/rules/api-integration.md`: a typed client built from the documented schemas, addresses and credentials from configuration, every documented outcome a state with a test whose response is shaped as documented.
5. **The gate and the spec check** run in `gates`, `facts`, `verify` and CI.
6. **The review.** The PR template asks for the operations used, how each documented error is shown, and any documentation that looked wrong.

## What the gate checks

`./scripts/sdlc api check` (the `repo.api` gate) fails when:

- `apis.json` is not valid, or lists a name or a file that is not a plain name inside `.ai/api/`.
- A listed file is missing, or is not byte for byte what was imported (it was edited or replaced): the message says to import it again.
- A generated `endpoints.md` is not what its document produces (somebody edited it, or this tool's format changed): `./scripts/sdlc api sync` rewrites it.
- A folder in `.ai/api/` is not listed in `apis.json`.

The spec check (in `facts`, `verify`, `implement` and `spec`) also fails when:

- A PRD has no **API integration** section (any of `## 7. API integration`, `## API integration` or `### api integration` counts). `No API calls.` is a complete one.
- The section lists no operation and does not say `No API calls.`.
- It names `` `GET /path` `` that no imported document and no backend contract has, and says which paths are close, or which methods the path does have. Parameter names do not matter (`/pets/{id}` is `/pets/{petId}`), a real value fits a parameter (`/pets/7`), and a server's base path is optional (`/api/v3/pets`).
- It names an operation and nothing is imported (and the project has no backend).

## What it does not check

- That the real API behaves as documented, and that the documentation is current. Import the document again when the API changes and read what was added or removed. The facts against the running system prove the backend a project **owns**; for an API owned by someone else, the tests prove the screen handles responses shaped as documented.
- That the code calls only what the PRD lists. The PRD lists the operations, and a reviewer reads the client; scanning source code for paths is too fragile to be a gate.
- Operations in a guide, in a YAML file the tool cannot read, or in a Postman collection beyond its method, path and examples.

Not built yet: a mock server generated from the documentation (so a screen could be proven against documented responses in CI), contract tests against the live API, other formats (GraphQL, gRPC, AsyncAPI, HAR), documentation behind a login, and the API layer in `adopt`ed existing projects.

## Configuration

```yaml
api:
  enforce: true        # the repo.api gate, and the API integration section in every PRD
```

`enforce: false` removes the gate and the mandatory section (and the sections after it are renumbered); the commands, the rule and the skill stay, and `api check` still works by hand. A backend on its own has none of this. The gate is also dropped when `sdlc.gates.lint` is off.

## How this was checked

The YAML reader is the part most likely to be wrong, so it was checked hardest: `npm test` reads back 600 random documents written by the `yaml` library in twelve styles and requires them to be identical (a one-off run of 3,000 in thirteen styles agreed too), and the petstore document reads the same as it does in libyaml (Ruby).
`npm test` runs the real `./scripts/sdlc` against a petstore document (YAML and JSON), a Swagger 2.0 document, a Postman collection, a guide, links served by a local server, every refusal, every way the gate fails, and the PRD check. The generated Python runs on Python 3.9, the oldest the tool supports.
Everything else, and what was and was not run, is in [Status and Limits](Status-and-Limits#the-api-integration-layer).
