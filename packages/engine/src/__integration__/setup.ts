/**
 * Integration-tier preflight.
 *
 * Refuses to run without a database, loudly, rather than skipping. A tier
 * that quietly skips itself when its dependency is missing is the one that
 * stops running and nobody notices — the suite still reports success, and
 * the seams it exists to cover go uncovered for months.
 *
 * The message names the variable and the command, because this is operator
 * tooling: a person running the wrong thing locally should be told exactly
 * what to run. (Errors a CUSTOMER can see are held to the opposite rule.)
 */

const REQUIRED = "MUD_DATABASE_URL";

beforeAll(() => {
  if (!process.env[REQUIRED]?.trim()) {
    throw new Error(
      `${REQUIRED} is not set, so the integration tier has no database to run against.\n\n` +
        "This tier deliberately does NOT fall back to mocks — the whole point of it is\n" +
        "that a mocked Prisma client agrees with queries the real schema rejects.\n\n" +
        "To run it locally:\n" +
        "  docker run -d --name mud-it -e POSTGRES_USER=mud -e POSTGRES_PASSWORD=mud \\\n" +
        "    -e POSTGRES_DB=mud -p 55432:5432 postgres:16\n" +
        "  export MUD_DATABASE_URL='postgresql://mud:mud@127.0.0.1:55432/mud?sslmode=disable'\n" +
        "  npm run db:bootstrap --workspace @nehsamud/engine-db\n" +
        "  npm run prisma:migrate:deploy --workspace @nehsamud/engine-db\n" +
        "  npm run seed\n" +
        "  npm run test:integration",
    );
  }
});
