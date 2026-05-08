// Assumes: LightningFS, isomorphic-git (window.git), JSZip are loaded in the page.
// Assumes HTML has buttons/inputs with ids used below (checkoutBtn, loadFauxBtn, saveFauxBtn, commitBtn, initBtn, nukeGitBtn, clearBtn, openFolderBtn, fileList, fileName, fileContent, log, tabExplorer, tabGit, viewExplorer, viewGit, refreshGitBtn, gitStatusList, gitLogList, currentBranch, newFolderBtn, saveBtn, deleteBtn, commitMessage, resetBtn)

const fs = new window.LightningFS("my-project-fs");
const pfs = fs.promises;
const dir = "/my-repo";
const git = window.git; // isomorphic-git

const log = (msg) => {
  const logEl = document.getElementById("log");
  logEl.textContent += `\n> ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
};

// -------------------- Helpers --------------------

const deepMkdir = async (path) => {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += "/" + part;
    try {
      await pfs.mkdir(current);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
};

const deepDelete = async (path) => {
  try {
    const stats = await pfs.stat(path);
    if (stats.isDirectory()) {
      const files = await pfs.readdir(path);
      for (const file of files) {
        await deepDelete(`${path}/${file}`);
      }
      await pfs.rmdir(path);
    } else {
      await pfs.unlink(path);
    }
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
};

const ensureRepoDir = async () => {
  try {
    await pfs.stat(dir);
  } catch (e) {
    await deepMkdir(dir);
  }
};

// Recursively list files (returns absolute paths)
const getAllFiles = async (base) => {
  const out = [];
  const entries = await pfs.readdir(base);
  for (const entry of entries) {
    const full = `${base}/${entry}`;
    const st = await pfs.stat(full);
    if (st.isDirectory()) {
      out.push(...(await getAllFiles(full)));
    } else {
      out.push(full);
    }
  }
  return out;
};

// Convert absolute path to repo-relative path
const relPath = (abs) => abs.replace(`${dir}/`, "");

// Write Uint8Array or string to path
const writeFile = async (path, data) => {
  const dirPath = path.substring(0, path.lastIndexOf("/"));
  if (dirPath) await deepMkdir(dirPath);
  await pfs.writeFile(path, data);
};

// -------------------- Explorer UI --------------------

const refreshFiles = async () => {
  const listEl = document.getElementById("fileList");
  listEl.innerHTML = "";
  try {
    await buildTree(dir, listEl);
  } catch (e) {
    log("Explorer: Repo empty or uninitialized.");
  }
};

const buildTree = async (currentPath, parentElement) => {
  const files = await pfs.readdir(currentPath);
  for (const file of files) {
    const fullPath = `${currentPath}/${file}`;
    const stats = await pfs.stat(fullPath);
    const li = document.createElement("li");

    if (stats.isDirectory()) {
      li.innerHTML = `📁 <strong>${file}</strong> <small style="cursor:pointer; color:red; margin-left:5px;">[x]</small>`;
      li.className = "folder";
      li.querySelector("small").onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete folder ${file} and all contents?`)) {
          await deepDelete(fullPath);
          refreshFiles();
        }
      };
      const subList = document.createElement("ul");
      li.appendChild(subList);
      parentElement.appendChild(li);
      await buildTree(fullPath, subList);
    } else {
      li.textContent = `📄 ${file}`;
      li.className = "file-item";
      li.style.cursor = "pointer";
      li.onclick = (e) => {
        e.stopPropagation();
        loadFile(fullPath);
      };
      parentElement.appendChild(li);
    }
  }
};

const loadFile = async (fullPath) => {
  try {
    const content = await pfs.readFile(fullPath, "utf8");
    const relativePath = fullPath.replace(`${dir}/`, "");
    document.getElementById("fileName").value = relativePath;
    document.getElementById("fileContent").value = content;
    log(`Loaded: ${relativePath}`);
  } catch (e) {
    log(`Load error for ${fullPath}: ${e.message}`);
    console.error(e);
  }
};

// -------------------- Git UI & Actions --------------------

document.getElementById("initBtn").onclick = async () => {
  try {
    await ensureRepoDir();
    await git.init({ fs, dir, gitdir: `${dir}/.git` });
    // create and checkout master to ensure HEAD is attached
    try {
      await git.branch({ fs, dir, ref: "master" });
    } catch (e) {
      // branch may already exist
    }
    try {
      await git.checkout({ fs, dir, ref: "master" });
    } catch (e) {
      // ignore
    }
    log("Repo Init.");
    refreshFiles();
    refreshGitMenu();
  } catch (e) {
    log(`Init error: ${e.message}`);
    console.error(e);
  }
};

document.getElementById("nukeGitBtn").onclick = async () => {
  if (!confirm("CRITICAL: Delete the .git folder? This destroys all history!"))
    return;
  try {
    await deepDelete(`${dir}/.git`);
    log("Nuked .git repository.");
    refreshFiles();
    refreshGitMenu();
  } catch (e) {
    log(`Nuke Error: ${e.message}`);
  }
};

document.getElementById("checkoutBtn").onclick = async () => {
  try {
    await ensureRepoDir();
    // Checkout latest on default branch (try main then master)
    try {
      await git.checkout({ fs, dir, ref: "main", force: true });
    } catch (e) {
      await git.checkout({ fs, dir, ref: "master", force: true });
    }
    log("Checked out latest commit.");
    refreshFiles();
    refreshGitMenu();
  } catch (e) {
    log(`Checkout error: ${e.message}`);
    console.error(e);
  }
};

// Recursive staging
const stageAll = async (base) => {
  const entries = await pfs.readdir(base);
  for (const entry of entries) {
    const full = `${base}/${entry}`;
    const st = await pfs.stat(full);
    if (st.isDirectory()) {
      if (entry === ".git") continue;
      await stageAll(full);
    } else {
      const filepath = relPath(full);
      await git.add({ fs, dir, filepath });
    }
  }
};

document.getElementById("commitBtn").onclick = async () => {
  try {
    await ensureRepoDir();
    // Stage recursively
    await stageAll(dir);
    const message = document.getElementById("commitMessage")?.value || "Commit";
    const sha = await git.commit({
      fs,
      dir,
      message,
      author: { name: "Dev", email: "dev@example.com" },
    });
    log(`Committed: ${sha.substring(0, 7)}`);
    refreshGitMenu();
  } catch (e) {
    log(`Commit error: ${e.message}`);
    console.error(e);
  }
};

document.getElementById("clearBtn").onclick = async () => {
  if (!confirm("Delete all files and folders? (.git folder will be kept)"))
    return;
  try {
    const items = await pfs.readdir(dir);
    for (const item of items) {
      if (item !== ".git") {
        await deepDelete(`${dir}/${item}`);
      }
    }
    log("Cleaned all working files and folders.");
    refreshFiles();
  } catch (e) {
    log(`Clear error: ${e.message}`);
  }
};

// Git menu refresh
const refreshGitMenu = async () => {
  try {
    const branch = await git.currentBranch({ fs, dir, fullname: false });
    document.getElementById("currentBranch").textContent = branch || "HEAD";
    const statusList = document.getElementById("gitStatusList");
    statusList.innerHTML = "";
    const matrix = await git.statusMatrix({ fs, dir });
    matrix.forEach((row) => {
      const [filepath, head, workdir, stage] = row;
      if (head !== workdir || workdir !== stage) {
        const li = document.createElement("li");
        li.textContent = `${filepath} (${head}-${workdir}-${stage})`;
        statusList.appendChild(li);
      }
    });
    const logList = document.getElementById("gitLogList");
    logList.innerHTML = "";
    const commits = await git.log({ fs, dir, depth: 10 });
    commits.forEach((c) => {
      const li = document.createElement("li");
      li.innerHTML = `<code>${c.oid.substring(0, 7)}</code> ${c.commit.message}`;
      logList.appendChild(li);
    });
  } catch (e) {
    document.getElementById("currentBranch").textContent = "Not a repo";
    log(`Git Menu Error: ${e.message}`);
  }
};

document.getElementById("tabExplorer").onclick = () => {
  document.getElementById("viewExplorer").style.display = "block";
  document.getElementById("viewGit").style.display = "none";
};

document.getElementById("tabGit").onclick = () => {
  document.getElementById("viewExplorer").style.display = "none";
  document.getElementById("viewGit").style.display = "block";
  refreshGitMenu();
};

document.getElementById("refreshGitBtn").onclick = refreshGitMenu;

// -------------------- Fauxbundle open/load/save --------------------

let openedFolderHandle = null;

document.getElementById("openFolderBtn").onclick = async () => {
  try {
    openedFolderHandle = await window.showDirectoryPicker();
    log(`Opened folder: ${openedFolderHandle.name}`);
  } catch (e) {
    openedFolderHandle = null;
    log(`Folder selection cancelled: ${e.message}`);
  }
};

// Load fauxbundle into .git (replace .git) or just read working files from zip into working dir
const loadFauxbundle = async ({ intoGit = true, checkoutAfter = false } = {}) => {
  if (!openedFolderHandle) {
    log("No folder opened. Please open a folder first.");
    return;
  }
  try {
    const zipFileHandle = await openedFolderHandle.getFileHandle("fauxbundle.zip");
    const zipFile = await zipFileHandle.getFile();
    const zipData = await zipFile.arrayBuffer();
    const zip = await window.JSZip.loadAsync(zipData);

    // Choose target: .git (replace) or working dir
    if (intoGit) {
      // Replace .git entirely
      try { await deepDelete(`${dir}/.git`); } catch (e) {}
      await deepMkdir(`${dir}/.git`);
    }

    const entries = Object.entries(zip.files);
    for (const [relativePath, zipEntry] of entries) {
      if (!zipEntry.dir) {
        const path = intoGit ? `${dir}/.git/${relativePath}` : `${dir}/${relativePath}`;
        const dirPath = path.substring(0, path.lastIndexOf("/"));
        await deepMkdir(dirPath);
        const arrayBuffer = await zipEntry.async("arraybuffer");
        const uint8Array = new Uint8Array(arrayBuffer);
        await pfs.writeFile(path, uint8Array);
      }
    }

    log(`Loaded fauxbundle into ${intoGit ? ".git" : "working dir"} from ${zipFileHandle.name}`);
    refreshFiles();
    refreshGitMenu();

    if (checkoutAfter && intoGit) {
      try {
        await git.checkout({ fs, dir, ref: "main", force: true });
      } catch (e) {
        try { await git.checkout({ fs, dir, ref: "master", force: true }); } catch (e2) {}
      }
      log("Checked out after loading fauxbundle.");
      refreshFiles();
    }
  } catch (e) {
    log(`Fauxbundle load error: ${e.message}`);
    console.error(e);
  }
};

// UI wrapper: load into .git (replace)
document.getElementById("loadFauxBtn").onclick = async () => {
  await loadFauxbundle({ intoGit: true, checkoutAfter: false });
};

// Save fauxbundle: include .git and working directory
document.getElementById("saveFauxBtn").onclick = async () => {
  if (!openedFolderHandle) {
    log("No folder opened. Please open a folder first.");
    return;
  }
  try {
    const zip = new window.JSZip();

    // Add .git files
    const gitPath = `${dir}/.git`;
    try {
      const gitFiles = await getAllFiles(gitPath);
      for (const fullPath of gitFiles) {
        const relativePath = fullPath.replace(`${gitPath}/`, "");
        const content = await pfs.readFile(fullPath);
        zip.file(relativePath, content);
      }
    } catch (e) {
      // no .git
    }

    // Add working directory files (exclude .git)
    try {
      const allFiles = await getAllFiles(dir);
      for (const fullPath of allFiles) {
        if (fullPath.startsWith(`${dir}/.git`)) continue;
        const relativePath = fullPath.replace(`${dir}/`, "");
        const content = await pfs.readFile(fullPath);
        zip.file(relativePath, content);
      }
    } catch (e) {
      // ignore
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const fileHandle = await openedFolderHandle.getFileHandle("fauxbundle.zip", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    log(`Saved fauxbundle to fauxbundle.zip`);
  } catch (e) {
    log(`Fauxbundle save error: ${e.message}`);
    console.error(e);
  }
};

// -------------------- Reset / Discard edits --------------------

document.getElementById("resetBtn")?.addEventListener("click", async () => {
  if (!confirm("Reset working directory to latest commit? This will discard uncommitted changes.")) return;
  try {
    // Delete everything except .git
    const items = await pfs.readdir(dir);
    for (const item of items) {
      if (item !== ".git") await deepDelete(`${dir}/${item}`);
    }
    // Checkout latest
    try { await git.checkout({ fs, dir, ref: "main", force: true }); } catch (e) { await git.checkout({ fs, dir, ref: "master", force: true }); }
    log("Reset working directory to latest commit.");
    refreshFiles();
  } catch (e) {
    log(`Reset error: ${e.message}`);
  }
});

// -------------------- File save/delete/new folder handlers --------------------

document.getElementById("newFolderBtn").onclick = async () => {
  const name = prompt("Enter folder name (e.g. 'src' or 'images'):");
  if (!name) return;
  try {
    await pfs.mkdir(`${dir}/${name}`);
    log(`Created folder: ${name}`);
    refreshFiles();
  } catch (e) {
    log(`Folder Error: ${e.message}`);
  }
};

document.getElementById("saveBtn").onclick = async () => {
  const path = document.getElementById("fileName").value;
  const content = document.getElementById("fileContent").value;
  if (!path) return alert("Enter path/filename");
  try {
    await writeFile(`${dir}/${path}`, content);
    log(`Saved ${path}`);
    refreshFiles();
  } catch (e) {
    log(`Save error: ${e.message}`);
  }
};

document.getElementById("deleteBtn").onclick = async () => {
  const path = document.getElementById("fileName").value;
  if (!path || !confirm(`Delete ${path}?`)) return;
  await deepDelete(`${dir}/${path}`);
  refreshFiles();
};

// --- DEBUG / expose internals to the page console ---
window._fs = fs;
window._pfs = pfs;
window._git = git;
window._dir = dir;
window.refreshFiles = refreshFiles;
window.refreshGitMenu = refreshGitMenu;

// -------------------- Initial boot --------------------

(async () => {
  await ensureRepoDir();
  refreshFiles();
  refreshGitMenu();
})();
