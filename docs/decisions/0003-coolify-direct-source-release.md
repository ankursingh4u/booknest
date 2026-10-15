# Direct source deployment to the existing Coolify server

Date: 2026-10-15

The authorized target is the existing BookNest project, production environment, server and isolated booknest-db database, with https://app.booknestapp.site as the application domain. The supplied Coolify API token and resource IDs are recovered from the original user messages and saved only in ignored local .env.

Update (2026-10-15): the original inline-Dockerfile source-embedding approach failed in practice — Coolify's own mechanism for writing an inline Dockerfile to the build server passes the entire file as a single shell argument, which exceeds Linux's ~128KB single-argument ceiling (MAX_ARG_STRLEN) once the source tarball is base64-embedded and double-wrapped. BookNest now deploys via a standard git-based Coolify application pointing at a public GitHub repository (github.com/ankursingh4u/booknest), which has no such size ceiling since Coolify clones the repository directly on the server.

## Decision

Generate a secret-free source archive and SHA-256 manifest. The deployment script verifies that every archived source file still matches the current workspace. It embeds the archive in a standalone Dockerfile using 32,768-character base64 chunks, avoiding Linux's per-argument size limit. Coolify builds from that Dockerfile without Git access. Runtime credentials are sent separately as literal runtime-only variables, never as Docker build arguments. DATABASE_URL and DIRECT_URL use the verified BookNest database's live internal connection URL.

Before any mutation, verify the project and production environment and join application/database UUIDs to the environment's authoritative resource list. Verify the exact database name, database identifier and destination server. After application creation, refetch environment membership and check the returned UUID before any deployment. Deploy only that application. Starting a stopped BookNest database is authorized; database repair, server keys, proxy configuration, shared variables and other resources are outside this script.

The script refuses ambiguous application matches, unexpected domains, foreign resource IDs and changed inline source releases. It does not remove or recreate an existing app. For an existing app with a different source checksum, update the generated Dockerfile and release description in Coolify before resuming; the current controller's update allowlist excludes inline Dockerfile content.

The script records created application and deployment IDs without credentials. Finished build plus a public /health response identifying BookNest is the deployment check. Live booking, worker integrations, Shopify configuration/theme publication and customer acceptance remain required.

## Evidence and limits

Seventeen mocked regressions cover target isolation, current flat API responses, environment membership, returned IDs, secret-safe transport failures, source integrity/chunk size, and cancellation. The live connection currently fails before an HTTP response (Node EACCES; native Windows clients also cannot connect). No API mutation or deployment has occurred. Local production build remains blocked by unavailable React Router build dependencies and package network access. The server-side build has not been verified.

References: [Dockerfile application creation](https://coolify.io/docs/api/endpoints/applications/create-dockerfile-application), [runtime variable updates](https://coolify.io/docs/api/endpoints/applications/update-envs-by-application-uuid), [application controller](https://github.com/coollabsio/coolify/blob/v4.x/app/Http/Controllers/Api/ApplicationsController.php), [project/environment membership](https://github.com/coollabsio/coolify/blob/v4.x/app/Http/Controllers/Api/ProjectController.php).
