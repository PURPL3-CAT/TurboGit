const fs = new window.LightningFS('my-project-fs');
const pfs = fs.promises;
const dir = '/my-repo';

const log = (msg) => {
  const logEl = document.getElementById('log');
  logEl.textContent += `\n> ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
};

// --- RECURSIVE DELETE HELPER ---
const deepDelete = async (path) => {
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
};

// --- RECURSIVE MKDIR HELPER ---
const deepMkdir = async (path) => {
  const parts = path.split('/').filter(p => p);
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    try {
      await pfs.mkdir(current);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
};

// --- EXPLORER & TREE ---
const refreshFiles = async () => {
  const listEl = document.getElementById('fileList');
  listEl.innerHTML = '';
  try {
    await buildTree(dir, listEl);
  } catch (e) {
    log('Explorer: Repo empty or uninitialized.');
  }
};

const buildTree = async (currentPath, parentElement) => {
  const files = await pfs.readdir(currentPath);

  for (const file of files) {
    const fullPath = `${currentPath}/${file}`;
    const stats = await pfs.stat(fullPath);
    const li = document.createElement('li');

    if (stats.isDirectory()) {
      li.innerHTML = `📁 <strong>${file}</strong> <small style="cursor:pointer; color:red; margin-left:5px;">[x]</small>`;
      li.className = 'folder';

      // Folder Delete Handler
      li.querySelector('small').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete folder ${file} and all contents?`)) {
          await deepDelete(fullPath);
          refreshFiles();
        }
      };

      const subList = document.createElement('ul');
      li.appendChild(subList);
      parentElement.appendChild(li);
      await buildTree(fullPath, subList);
    } else {
      // FILE ITEM
      li.textContent = `📄 ${file}`;
      li.className = 'file-item';
      li.style.cursor = 'pointer';

      // FIX: Ensure the click event passes the fullPath correctly
      li.onclick = (e) => {
        e.stopPropagation(); // Prevent folder clicks from interfering
        loadFile(fullPath);
      };

      parentElement.appendChild(li);
    }
  }
};

const loadFile = async (fullPath) => {
  try {
    // Read the file using the full absolute path in the virtual FS
    const content = await pfs.readFile(fullPath, 'utf8');

    // Update the UI
    // We strip the base 'dir' (e.g., /my-repo/) to show the relative path in the input
    const relativePath = fullPath.replace(`${dir}/`, '');
    document.getElementById('fileName').value = relativePath;
    document.getElementById('fileContent').value = content;

    log(`Loaded: ${relativePath}`);
  } catch (e) {
    log(`Load error for ${fullPath}: ${e.message}`);
    console.error(e);
  }
};

// --- HANDLERS ---

document.getElementById('newFolderBtn').onclick = async () => {
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

document.getElementById('saveBtn').onclick = async () => {
  const path = document.getElementById('fileName').value;
  const content = document.getElementById('fileContent').value;
  if (!path) return alert('Enter path/filename');
  try {
    await pfs.writeFile(`${dir}/${path}`, content);
    log(`Saved ${path}`);
    refreshFiles();
  } catch (e) {
    log(`Save error: ${e.message}`);
  }
};

document.getElementById('deleteBtn').onclick = async () => {
  const path = document.getElementById('fileName').value;
  if (!path || !confirm(`Delete ${path}?`)) return;
  await pfs.unlink(`${dir}/${path}`);
  refreshFiles();
};

document.getElementById('nukeGitBtn').onclick = async () => {
  if (!confirm('CRITICAL: Delete the .git folder? This destroys all history!'))
    return;
  try {
    await deepDelete(`${dir}/.git`);
    log('Nuked .git repository.');
    refreshFiles();
  } catch (e) {
    log(`Nuke Error: ${e.message}`);
  }
};

// Standard Git logic from previous turns...
document.getElementById('initBtn').onclick = async () => {
  await window.git.init({ fs, dir });
  log('Repo Init.');
  refreshFiles();
};

document.getElementById('commitBtn').onclick = async () => {
  const files = await pfs.readdir(dir);
  for (let f of files)
    if (f !== '.git') await window.git.add({ fs, dir, filepath: f });
  const sha = await window.git.commit({
    fs,
    dir,
    message: 'Commit',
    author: { name: 'Dev', email: 'dev@example.com' },
  });
  log(`Committed: ${sha.substring(0, 7)}`);
};

document.getElementById('clearBtn').onclick = async () => {
  if (!confirm('Delete all files and folders? (.git folder will be kept)'))
    return;

  try {
    const items = await pfs.readdir(dir);
    for (const item of items) {
      // Safety check to keep the git history
      if (item !== '.git') {
        await deepDelete(`${dir}/${item}`);
      }
    }
    log('Cleaned all working files and folders.');
    refreshFiles();
  } catch (e) {
    log(`Clear error: ${e.message}`);
  }
};

// --- GIT MENU LOGIC ---

const refreshGitMenu = async () => {
  try {
    // 1. Current Branch
    const branch = await window.git.currentBranch({ fs, dir });
    document.getElementById('currentBranch').textContent = branch || 'HEAD';

    // 2. Git Status (Status Matrix)
    const statusList = document.getElementById('gitStatusList');
    statusList.innerHTML = '';
    const matrix = await window.git.statusMatrix({ fs, dir });

    matrix.forEach((row) => {
      const [filepath, head, workdir, stage] = row;
      // If file is changed (workdir !== head)
      if (head !== workdir || workdir !== stage) {
        const li = document.createElement('li');
        li.textContent = `${filepath} (${head}-${workdir}-${stage})`;
        statusList.appendChild(li);
      }
    });

    // 3. Git Log (History)
    const logList = document.getElementById('gitLogList');
    logList.innerHTML = '';
    const commits = await window.git.log({ fs, dir, depth: 5 });

    // Replace the Log rendering loop in refreshGitMenu with this:
    commits.forEach((c) => {
      const li = document.createElement('li');
      // Format: [sha] Short Message
      li.innerHTML = `<code>${c.oid.substring(0, 7)}</code> ${
        c.commit.message
      }`;
      logList.appendChild(li);
    });
  } catch (e) {
    document.getElementById('currentBranch').textContent = 'Not a repo';
    log(`Git Menu Error: ${e.message}`);
  }
};

// Tab Switching
document.getElementById('tabExplorer').onclick = () => {
  document.getElementById('viewExplorer').style.display = 'block';
  document.getElementById('viewGit').style.display = 'none';
};

document.getElementById('tabGit').onclick = () => {
  document.getElementById('viewExplorer').style.display = 'none';
  document.getElementById('viewGit').style.display = 'block';
  refreshGitMenu();
};

document.getElementById('refreshGitBtn').onclick = refreshGitMenu;

refreshFiles();

// --- FAUXBUNDLE FUNCTIONALITY ---
let openedFolderHandle = null;

document.getElementById('openFolderBtn').onclick = async () => {
  try {
    openedFolderHandle = await window.showDirectoryPicker();
    log(`Opened folder: ${openedFolderHandle.name}`);
  } catch (e) {
    openedFolderHandle = null;
    log(`Folder selection cancelled: ${e.message}`);
  }
};

document.getElementById('loadFauxBtn').onclick = async () => {
  if (!openedFolderHandle) {
    log('No folder opened. Please open a folder first.');
    return;
  }

  try {
    const zipFileHandle = await openedFolderHandle.getFileHandle(
      'fauxbundle.zip'
    );
    const zipFile = await zipFileHandle.getFile();
    const zipData = await zipFile.arrayBuffer();

    const zip = await window.JSZip.loadAsync(zipData);

    // Remove existing .git folder
    try {
      await pfs.stat(`${dir}/.git`);
      await deepDelete(`${dir}/.git`);
    } catch (e) {
      // .git does not exist
    }

    // Create .git directory
    await pfs.mkdir(`${dir}/.git`);

    // Extract zip contents
    const entries = Object.entries(zip.files);
    for (const [relativePath, zipEntry] of entries) {
      if (!zipEntry.dir) {
        const path = `${dir}/.git/${relativePath}`;
        const dirPath = path.substring(0, path.lastIndexOf('/'));

        // Ensure directory exists
        await deepMkdir(dirPath);

        // Write file
        const arrayBuffer = await zipEntry.async('arraybuffer');
        const uint8Array = new Uint8Array(arrayBuffer);
        await pfs.writeFile(path, uint8Array);
      }
    };

    log(`Loaded fauxbundle from ${zipFileHandle.name}`);
    refreshFiles();
    refreshGitMenu();
  } catch (e) {
    log(`Fauxbundle load error: ${e.message}`);
  }
};

document.getElementById('saveFauxBtn').onclick = async () => {
  if (!openedFolderHandle) {
    log('No folder opened. Please open a folder first.');
    return;
  }

  try {
    // Initialize a new JSZip object
    const zip = new window.JSZip();

    // Get all files recursively from .git directory
    const getAllFiles = async (dir) => {
      const entries = await pfs.readdir(dir);
      const files = [];
      for (const entry of entries) {
        const fullPath = `${dir}/${entry}`;
        const stat = await pfs.stat(fullPath);
        if (stat.isDirectory()) {
          files.push(...(await getAllFiles(fullPath)));
        } else {
          files.push(fullPath);
        }
      }
      return files;
    };

    const gitPath = `${dir}/.git`;
    const files = await getAllFiles(gitPath);

    // Add files to zip
    for (const fullPath of files) {
      const relativePath = fullPath.replace(`${gitPath}/`, '');
      const content = await pfs.readFile(fullPath);
      zip.file(relativePath, content);
    }

    // Generate and save ZIP
    const blob = await zip.generateAsync({ type: 'blob' });
    const fileHandle = await openedFolderHandle.getFileHandle(
      'fauxbundle.zip',
      { create: true }
    );
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    log(`Saved fauxbundle to fauxbundle.zip`);
  } catch (e) {
    log(`Fauxbundle save error: ${e.message}`);
    console.error(e);
  }
};
