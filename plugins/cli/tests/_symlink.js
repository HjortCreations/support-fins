// Probe only the optional filesystem capability. Other IO/security checks always run.
let probe;
export function canSymlink() {
  return probe ??= test();
}
async function test() {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/target`, "probe");
    await Deno.symlink(`${dir}/target`, `${dir}/link`);
    return true;
  } catch (error) {
    if (
      Deno.build.os === "windows" &&
      /1314|privilege|EPERM|not permitted/i.test(String(error))
    ) return false;
    throw error;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
