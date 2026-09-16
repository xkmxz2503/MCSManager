import fs from "fs-extra";
import { $t } from "../i18n";
import InstanceSubsystem from "../service/system_instance";
import FileManager from "./system_file";
import os from "os";
import { toText } from "mcsmanager-common";
import { resolveDockerWorkspacePath } from "../tools/docker_workspace_path";

export function getFileManager(instanceUuid: string) {
  // Initialize a file manager for the instance, and assign codes, restrictions, etc.
  const instance = InstanceSubsystem.getInstance(instanceUuid);
  if (!instance)
    throw new Error($t("TXT_CODE_file_router_service.instanceNotExit", { uuid: instanceUuid }));
  const fileCode = instance.config?.fileCode;

  // Get the working directory, considering Docker workspace path mapping
  let cwd = instance.absoluteCwdPath();

  // If Docker mode is enabled and custom workspace path is set, use the mapped path
  if (instance.config?.processType === "docker") {
    const defaultInstanceDir = InstanceSubsystem.getInstanceDataDir();
    const hostRealPath = toText(process.env.MCSM_DOCKER_WORKSPACE_PATH);
    if (hostRealPath) {
      cwd = resolveDockerWorkspacePath(cwd, defaultInstanceDir, hostRealPath);
    }
  }

  return new FileManager(cwd, fileCode);
}

let cacheDisks: string[] = [];

export function getWindowsDisks() {
  if (os.platform() !== "win32") return [];
  if (cacheDisks.length > 0) return cacheDisks;
  const res: string[] = [];
  // A - Z
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    try {
      if (fs.existsSync(`${letter}:\\`)) res.push(letter);
    } catch (error) {
      // ignore error
    }
  }
  cacheDisks = res;
  return res;
}
