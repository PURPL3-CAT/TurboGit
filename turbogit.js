//========== DIRECTORY SETUP ============
let root;

async function initTurboGit() {
  // 1) Ensure JSZip is available
  if (typeof JSZip !== "function") {
    await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
  }

  // 2) Ask user for the export/import directory
  root = await window.showDirectoryPicker();

  class TurboGitExtension {
    getInfo() {
      return {
        id: "isloaded",
        name: "TurboGit",
        blocks: [
          {
            opcode: "isLoaded",
            blockType: "Boolean",
            text: "turbogit loaded?",
          },
        ],
      };
    }

    isLoaded() {
      return true;
    }
  }

  Scratch.extensions.register(new TurboGitExtension());
}

// =========== UI SETUP ============
function waitForElement(selector) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) {
      resolve(el);
      return;
    }
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function createUI() {
  if (!document.querySelectorAll('[id*="turbogit"]')[0]) {
    const firstMenuItem = document.querySelectorAll(
      '[class*="menu-bar-item"]',
    )[0];
    const fragment = document.createDocumentFragment();
    const items = ["Push", "Pull"];

    items.forEach((text) => {
      const button = document.createElement("div");
      button.id = `turbogit-${text.toLowerCase()}`;
      button.textContent = text;
      button.className = firstMenuItem.className;
      button.addEventListener("click", () => {
        if (text === "Push") {
          exportProject(vm);
        } else if (text === "Pull") {
          compileToSB3();
        }
      });
      const svgString = {
        Push: `<svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
        <path fill-rule="evenodd" d="M3 6a3 3 0 1 1 4 2.83v6.34a3.001 3.001 0 1 1-2 0V8.83A3.001 3.001 0 0 1 3 6Zm11.207-2.707a1 1 0 0 1 0 1.414L13.914 5H15a4 4 0 0 1 4 4v6.17a3.001 3.001 0 1 1-2 0V9a2 2 0 0 0-2-2h-1.086l.293.293a1 1 0 0 1-1.414 1.414l-2-2a1 1 0 0 1 0-1.414l2-2a1 1 0 0 1 1.414 0Z" clip-rule="evenodd"/>
        </svg>`,
        Pull: `<svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 3a3 3 0 0 0-1 5.83v6.34a3.001 3.001 0 1 0 2 0V15a2 2 0 0 1 2-2h1a5.002 5.002 0 0 0 4.927-4.146A3.001 3.001 0 0 0 16 3a3 3 0 0 0-1.105 5.79A3.001 3.001 0 0 1 12 11h-1c-.729 0-1.412.195-2 .535V8.83A3.001 3.001 0 0 0 8 3Z"/>
        </svg>`,
      }[text];
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, "image/svg+xml");
      const svgElement = doc.documentElement;
      button.prepend(svgElement);
      fragment.appendChild(button);
    });

    firstMenuItem.parentElement.prepend(fragment);
  }
}

(async () => {
  await initTurboGit();
  waitForElement('[class*="menu-bar-item"]').then(createUI);
})();

function normalizeLineEndingsCRLF(text) {
  return text.replace(/\r?\n/g, "\r\n");
}

//exportProject(vm) - Exports all original sprites from the VM to the selected folder
async function exportProject(vm) {
  //1. Clear existing contents of the folder except for .git
  for await (const [name, handle] of root.entries()) {
    if (name === ".git") continue;
    if (handle.kind === "file") {
      await root.removeEntry(name);
    } else if (handle.kind === "directory") {
      await deleteDirRecursive(handle);
      await root.removeEntry(name, { recursive: true });
    }
  }

  // 2. Get only original sprites (ignore clones)
  const originals = vm.runtime.targets.filter((t) => t.isOriginal);

  for (const target of originals) {
    const sprite = target.sprite;
    const name = sprite.name;

    // 3. Create folder for this sprite
    const spriteFolder = await root.getDirectoryHandle(name, { create: true });

    //
    // === BLOCKS ===
    //
    const blocksObj = {
      blocks: sprite.blocks._blocks,
      scripts: sprite.blocks._scripts,
    };

    const blocksFile = await spriteFolder.getFileHandle("blocks.json", {
      create: true,
    });
    const blocksWritable = await blocksFile.createWritable();
    await blocksWritable.write(
      normalizeLineEndingsCRLF(JSON.stringify(blocksObj, null, 2)),
    );
    await blocksWritable.close();

    //
    // === VARIABLES ===
    // Save the raw runtime variable records so we can rebuild SB3 project variables and broadcasts later.
    const variableMap = target.variables || {};
    const variablesFile = await spriteFolder.getFileHandle("variables.json", {
      create: true,
    });
    const variablesWritable = await variablesFile.createWritable();
    await variablesWritable.write(
      normalizeLineEndingsCRLF(JSON.stringify(variableMap, null, 2)),
    );
    await variablesWritable.close();

    const commentsObj = target.comments || sprite.comments || {};
    const commentsFile = await spriteFolder.getFileHandle("comments.json", {
      create: true,
    });
    const commentsWritable = await commentsFile.createWritable();
    await commentsWritable.write(
      normalizeLineEndingsCRLF(JSON.stringify(commentsObj, null, 2)),
    );
    await commentsWritable.close();

    //
    // === COSTUMES ===
    //
    const costumesFolder = await spriteFolder.getDirectoryHandle("costumes", {
      create: true,
    });

    const costumeMeta = [];

    for (const costume of sprite.costumes) {
      const filename = `${costume.name}.${costume.dataFormat}`;
      const fileHandle = await costumesFolder.getFileHandle(filename, {
        create: true,
      });
      const writable = await fileHandle.createWritable();

      // costume.asset.data is a Uint8Array
      await writable.write(costume.asset.data);
      await writable.close();

      costumeMeta.push({
        name: costume.name,
        dataFormat: costume.dataFormat,
        rotationCenterX: costume.rotationCenterX,
        rotationCenterY: costume.rotationCenterY,
      });
    }

    const costumeMetaFile = await costumesFolder.getFileHandle(
      "costumes.json",
      { create: true },
    );
    const costumeMetaWritable = await costumeMetaFile.createWritable();
    await costumeMetaWritable.write(
      normalizeLineEndingsCRLF(JSON.stringify(costumeMeta, null, 2)),
    );
    await costumeMetaWritable.close();

    //
    // === SOUNDS ===
    //
    const soundsFolder = await spriteFolder.getDirectoryHandle("sounds", {
      create: true,
    });

    const soundMeta = [];

    for (const sound of sprite.sounds) {
      const ext = sound.md5.split(".").pop();
      const filename = `${sound.name}.${ext}`;

      const fileHandle = await soundsFolder.getFileHandle(filename, {
        create: true,
      });
      const writable = await fileHandle.createWritable();

      // sound.asset.data is a Uint8Array
      await writable.write(sound.asset.data);
      await writable.close();

      soundMeta.push({
        name: sound.name,
        sampleCount: sound.sampleCount,
        rate: sound.rate,
      });
    }

    const soundMetaFile = await soundsFolder.getFileHandle("sounds.json", {
      create: true,
    });
    const soundMetaWritable = await soundMetaFile.createWritable();
    await soundMetaWritable.write(
      normalizeLineEndingsCRLF(JSON.stringify(soundMeta, null, 2)),
    );
    await soundMetaWritable.close();
  }

  let extensionSources = Array.isArray(vm?.extensionManager?.workerURLs)
  ? vm.extensionManager.workerURLs
  : [];
  
  console.log("[TurboGit] current extension sources:", extensionSources);
  
  extensionSources = extensionSources.filter(src => {
    if (typeof src !== "string") return false;
    const s = src.toLowerCase();
    // Remove TurboGit in any form
    if (s.includes("turbogit")) return false;
    if (s.includes("vhvyrm9hit")) return false; // Base64 TurboGit
    // Remove data URLs (TurboGit inline)
    // if (s.startsWith("data:")) return false;
    // Remove blob URLs (TurboGit worker)
    // if (s.startsWith("blob:")) return false;
    return true;
  });

  console.log("[TurboGit] filtered extension sources for export:", extensionSources);

  const extensionsFile = await root.getFileHandle("extensions.json", {
    create: true,
  });
  const extensionsWritable = await extensionsFile.createWritable();
  await extensionsWritable.write(
    normalizeLineEndingsCRLF(JSON.stringify(extensionSources, null, 2)),
  );
  await extensionsWritable.close();

  console.log("Export complete!", {
    extensions: extensionSources,
  });
}

//compileAndLoad(vm) - Compiles the entire folder into an sb3 and loads it into the VM
// ============ CRC32 TABLE ============
let _crcTable;
function crc32(data) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        if (c & 1) c = 0xedb88320 ^ (c >>> 1);
        else c = c >>> 1;
      }
      _crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  const view = new Uint8Array(data);
  for (let i = 0; i < view.length; i++) {
    crc = _crcTable[(crc ^ view[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============ ZIP CREATOR (uncompressed, store mode) ============
function createZip(entries) {
  // entries: { "filename": Uint8Array | string }
  const localHeaders = [];
  const centralDir = [];
  let offset = 0;
  const names = Object.keys(entries);

  for (const name of names) {
    let data = entries[name];
    if (typeof data === "string") data = new TextEncoder().encode(data);
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

    const crc = crc32(data);
    const size = data.length;
    const compressedSize = size; // stored (no compression)

    // local file header
    const lh = new ArrayBuffer(30 + name.length);
    const dv = new DataView(lh);
    dv.setUint32(0, 0x04034b50, true); // signature
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 0, true); // compression = store
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    dv.setUint32(14, crc, true); // crc-32
    dv.setUint32(18, compressedSize, true); // compressed size
    dv.setUint32(22, size, true); // uncompressed size
    dv.setUint16(26, name.length, true); // filename length
    dv.setUint16(28, 0, true); // extra field length
    const nameBytes = new TextEncoder().encode(name);
    new Uint8Array(lh, 30).set(nameBytes);

    localHeaders.push(lh);

    // central directory entry
    const ce = new ArrayBuffer(46 + name.length);
    const dv2 = new DataView(ce);
    dv2.setUint32(0, 0x02014b50, true); // central dir signature
    dv2.setUint16(4, 20, true); // version made by
    dv2.setUint16(6, 20, true); // version needed
    dv2.setUint16(8, 0, true); // flags
    dv2.setUint16(10, 0, true); // compression = store
    dv2.setUint16(12, 0, true); // mod time
    dv2.setUint16(14, 0, true); // mod date
    dv2.setUint32(16, crc, true); // crc-32
    dv2.setUint32(20, compressedSize, true); // compressed size
    dv2.setUint32(24, size, true); // uncompressed size
    dv2.setUint16(28, name.length, true); // filename length
    dv2.setUint16(30, 0, true); // extra field length
    dv2.setUint16(32, 0, true); // comment length
    dv2.setUint16(34, 0, true); // disk number start
    dv2.setUint16(36, 0, true); // internal file attributes
    dv2.setUint32(38, 0, true); // external file attributes
    dv2.setUint32(42, offset, true); // relative offset of local header
    new Uint8Array(ce, 46).set(nameBytes);

    centralDir.push(ce);

    offset += lh.byteLength + size;
  }

  // end of central directory
  const totalCentralSize = centralDir.reduce((s, e) => s + e.byteLength, 0);
  const eo = new ArrayBuffer(22);
  const dv3 = new DataView(eo);
  dv3.setUint32(0, 0x06054b50, true); // signature
  dv3.setUint16(4, 0, true); // disk number
  dv3.setUint16(6, 0, true); // disk with central dir
  dv3.setUint16(8, names.length, true); // entries on this disk
  dv3.setUint16(10, names.length, true); // total entries
  dv3.setUint32(12, totalCentralSize, true); // central dir size
  dv3.setUint32(16, offset, true); // central dir offset
  dv3.setUint16(20, 0, true); // comment length

  // concatenate everything
  const totalSize = offset + totalCentralSize + eo.byteLength;
  const result = new Uint8Array(totalSize);
  let pos = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let data = entries[name];
    if (typeof data === "string") data = new TextEncoder().encode(data);
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

    result.set(new Uint8Array(localHeaders[i]), pos);
    pos += localHeaders[i].byteLength;
    result.set(data, pos);
    pos += data.length;
  }

  for (const ce of centralDir) {
    result.set(new Uint8Array(ce), pos);
    pos += ce.byteLength;
  }

  result.set(new Uint8Array(eo), pos);

  return result.buffer;
}

// ============ compileAndLoad ============
async function compileToSB3() {
  // root is the sprites folder
  let spriteDirs = await listDirs(root);
  spriteDirs = spriteDirs.filter(d => !d.name.startsWith("."));
  console.log(
    "[TurboGit] root sprite dirs:",
    spriteDirs.map((d) => d.name),
  );

  // Ensure Stage is first
  spriteDirs.sort((a, b) => {
    if (a.name === "Stage") return -1;
    if (b.name === "Stage") return 1;
    return 0;
  });

  console.log(
    "[TurboGit] sorted sprite dirs:",
    spriteDirs.map((d) => d.name),
  );

  const project = {
    meta: {
      semver: "3.0.0",
      vm: "0.2.0",
      agent: "custom",
    },
    targets: [],
    monitors: [],
    extensions: [],
  };

  let extensionSources = [];
  try {
    const extensionsFileHandle = await getFileIfExists(root, "extensions.json");
    if (extensionsFileHandle) {
      const file = await extensionsFileHandle.getFile();
      const extensionsText = await file.text();
      extensionSources = JSON.parse(extensionsText);
      if (!Array.isArray(extensionSources)) {
        console.warn(
          "[TurboGit] extensions.json did not contain an array, ignoring",
          extensionSources,
        );
        extensionSources = [];
      }
    }
  } catch (err) {
    console.error("[TurboGit] failed to read extensions.json", err);
    throw err;
  }

  console.log("[TurboGit] loaded extension sources:", extensionSources);
  // Remove TurboGit extension from list of extensions to export/load
  const filteredExtensionSources = extensionSources.filter(
    (src) =>
      typeof src === "string" &&
      !src.toLowerCase().includes("vhvyrm9hit") &&
      !src.toLowerCase().includes("turbogit"),
  );

  filteredExtensionSources.forEach((src) => {
    if (!vm.extensionManager.workerURLs.includes(src)) {
      vm.extensionManager.loadExtensionURL(src);
    }
  });

  console.log(
    "[TurboGit] filtered extension sources:",
    filteredExtensionSources,
  );
  console.log(
    "[TurboGit] vm.extensionManager.workerURLs:",
    vm?.extensionManager?.workerURLs,
  );

  const assets = [];

  for (const { name: spriteName, handle: spriteDir } of spriteDirs) {
    console.groupCollapsed(`[TurboGit] Compiling: ${spriteName}`);
    try {
      await logDirectoryContents(spriteDir, `root/${spriteName}`);

      //
      // === LOAD BLOCKS ===
      //
      const blocksText = await readTextFile(
        spriteDir,
        "blocks.json",
        `${spriteName}/blocks.json`,
      );
      const { blocks, scripts } = JSON.parse(blocksText);

      let variables = {};
      let broadcasts = {};
      let comments = {};

      try {
        const variablesFileHandle = await getFileIfExists(spriteDir, "variables.json");
        if (variablesFileHandle) {
          const variablesFile = await variablesFileHandle.getFile();
          const variablesText = await variablesFile.text();
          const parsedVariables = JSON.parse(variablesText);
          if (parsedVariables && typeof parsedVariables === "object" && !Array.isArray(parsedVariables)) {
            variables = normalizeScratchVariables(parsedVariables);
          } else {
            throw new Error("variables.json must contain an object");
          }
        }
      } catch (err) {
        console.warn(
          `[TurboGit] failed to load variables.json for ${spriteName}, using empty variables`,
          err,
        );
        variables = {};
      }

      try {
        const commentsFileHandle = await getFileIfExists(spriteDir, "comments.json");
        if (commentsFileHandle) {
          const commentsFile = await commentsFileHandle.getFile();
          const commentsText = await commentsFile.text();
          const parsedComments = JSON.parse(commentsText);
          if (parsedComments && typeof parsedComments === "object" && !Array.isArray(parsedComments)) {
            comments = parsedComments;
          } else {
            throw new Error("comments.json must contain an object");
          }
        }
      } catch (err) {
        console.warn(
          `[TurboGit] failed to load comments.json for ${spriteName}, using empty comments`,
          err,
        );
        comments = {};
      }

      // Normalize block fields before validation and loading.
      try {
        for (const bid of Object.keys(blocks || {})) {
          const blk = blocks[bid];
          if (!blk || typeof blk !== "object") continue;

          if (blk.inputs && typeof blk.inputs === "object") {
            for (const iname of Object.keys(blk.inputs)) {
              const ival = blk.inputs[iname];
              if (!Array.isArray(ival) && ival && typeof ival === "object") {
                const ref = ival.block ?? ival.shadow ?? null;
                if (ref) {
                  blk.inputs[iname] = [1, ref];
                } else if (Array.isArray(ival.value)) {
                  blk.inputs[iname] = ival.value;
                } else {
                  blk.inputs[iname] = [];
                }
              }
            }
          }

          if (blk.fields && typeof blk.fields === "object") {
            for (const fname of Object.keys(blk.fields)) {
              const fval = blk.fields[fname];
              if (!Array.isArray(fval) && fval && typeof fval === "object") {
                blk.fields[fname] = [fval.value ?? null, fval.id ?? null];
              }
            }
          }

          if (typeof blk.x === "string") {
            const parsedX = parseFloat(blk.x);
            blk.x = Number.isFinite(parsedX) ? parsedX : 0;
          }
          if (typeof blk.y === "string") {
            const parsedY = parseFloat(blk.y);
            blk.y = Number.isFinite(parsedY) ? parsedY : 0;
          }
          if (typeof blk.topLevel !== "boolean") {
            blk.topLevel = Boolean(blk.topLevel);
          }
          if (typeof blk.shadow !== "boolean") {
            blk.shadow = Boolean(blk.shadow);
          }
        }
        console.log(`[TurboGit] normalized block metadata for ${spriteName}`);
      } catch (err) {
        console.warn(
          `[TurboGit] failed to normalize blocks for ${spriteName}`,
          err,
        );
      }
      console.log(`[TurboGit] loaded blocks for ${spriteName}`);

      //
      // === LOAD COSTUMES ===
      //
      const costumesDir = await getDirectoryHandleWithDebug(
        spriteDir,
        "costumes",
        `${spriteName}/costumes`,
      );
      let costumeMeta;
      try {
        costumeMeta = JSON.parse(
          await readTextFile(
            costumesDir,
            "costumes.json",
            `${spriteName}/costumes/costumes.json`,
          ),
        );
      } catch (err) {
        if (err.name === "NotFoundError") {
          console.warn(
            `[TurboGit] missing costumes.json for ${spriteName}, inferring costume metadata from files`,
          );
          const files = await listFiles(costumesDir);
          await logDirectoryContents(costumesDir, `${spriteName}/costumes`);
          costumeMeta = files.map(({ name }) => {
            const parts = name.split(".");
            const ext = parts.pop();
            const base = parts.join(".");
            return {
              name: base,
              dataFormat: ext,
              rotationCenterX: 0,
              rotationCenterY: 0,
            };
          });
          if (costumeMeta.length === 0) throw err;
        } else {
          throw err;
        }
      }

      const costumes = [];
      for (const meta of costumeMeta) {
        const filename = `${meta.name}.${meta.dataFormat}`;
        console.log(
          `[TurboGit] reading costume file: ${spriteName}/costumes/${filename}`,
        );
        const data = await readBinaryFile(
          costumesDir,
          filename,
          `${spriteName}/costumes/${filename}`,
        );

        const assetId = await md5(data);
        const md5ext = `${assetId}.${meta.dataFormat}`;

        assets.push({ md5ext, data });

        costumes.push({
          assetId,
          md5ext,
          dataFormat: meta.dataFormat,
          name: meta.name,
          rotationCenterX: meta.rotationCenterX ?? 0,
          rotationCenterY: meta.rotationCenterY ?? 0,
        });
      }

      //
      // === LOAD SOUNDS ===
      //
      const soundsDir = await getDirIfExists(spriteDir, "sounds");
      let soundMeta = [];
      if (soundsDir) {
        try {
          soundMeta = JSON.parse(
            await readTextFile(
              soundsDir,
              "sounds.json",
              `${spriteName}/sounds/sounds.json`,
            ),
          );
        } catch (err) {
          if (err.name === "NotFoundError") {
            console.warn(
              `[TurboGit] missing sounds.json for ${spriteName}, inferring sound metadata from files`,
            );
            const files = await listFiles(soundsDir);
            await logDirectoryContents(soundsDir, `${spriteName}/sounds`);
            soundMeta = files.map(({ name }) => {
              const parts = name.split(".");
              const ext = parts.pop().toLowerCase();
              const base = parts.join(".");
              return {
                name: base,
                dataFormat: ext,
                rate: 44100,
                sampleCount: 0,
              };
            });
          } else {
            throw err;
          }
        }
      }

      const sounds = [];
      for (const meta of soundMeta) {
        let data, ext;

        try {
          ext = "wav";
          data = await readBinaryFile(
            soundsDir,
            `${meta.name}.wav`,
            `${spriteName}/sounds/${meta.name}.wav`,
          );
        } catch (firstErr) {
          console.warn(
            `[TurboGit] .wav missing for ${spriteName}/${meta.name}, trying mp3`,
            firstErr,
          );
          try {
            ext = "mp3";
            data = await readBinaryFile(
              soundsDir,
              `${meta.name}.mp3`,
              `${spriteName}/sounds/${meta.name}.mp3`,
            );
          } catch (secondErr) {
            console.error(
              `[TurboGit] failed to load sound for ${spriteName}/${meta.name}`,
              secondErr,
            );
            await logDirectoryContents(soundsDir, `${spriteName}/sounds`);
            throw secondErr;
          }
        }

        const assetId = await md5(data);
        const md5ext = `${assetId}.${ext}`;

        assets.push({ md5ext, data });

        sounds.push({
          assetId,
          md5ext,
          dataFormat: ext,
          name: meta.name,
          rate: meta.rate,
          sampleCount: meta.sampleCount,
        });
      }

      //
      // === BUILD TARGET ===
      //
      const isStage = spriteName === "Stage";

      const { targetVariables, targetBroadcasts } = await loadTargetVariables(
        spriteDir,
        spriteName,
      );

      const target = {
        isStage,
        name: spriteName,
        variables: targetVariables,
        lists: {},
        broadcasts: targetBroadcasts,
        comments,
        blocks,
        scripts,
        costumes,
        sounds,
        currentCostume: 0,
        volume: 100,
        layerOrder: isStage ? 0 : 1,
        visible: true,
        tempo: isStage ? 60 : undefined,
        videoTransparency: isStage ? 50 : undefined,
        videoState: isStage ? "on" : undefined,
        textToSpeechLanguage: isStage ? null : undefined,
      };

      if (!isStage) {
        // Sprite fields
        target.x = 0;
        target.y = 0;
        target.size = 100;
        target.direction = 90;
        target.draggable = false;
        target.rotationStyle = "all around";
      }

      project.targets.push(target);
      console.log(`[TurboGit] compiled target for ${spriteName}`);
    } catch (err) {
      console.error(
        `[TurboGit] compileToSB3 failed while processing ${spriteName}`,
      );
      console.error(err);
      console.groupEnd();
      throw err;
    }
    console.groupEnd();
  }

  //
  // === BUILD ZIP (.sb3) ===
  //
  const zip = new JSZip();

  zip.file("project.json", JSON.stringify(project, null, 2));

  for (const asset of assets) {
    zip.file(asset.md5ext, asset.data);
  }

  const blob = await zip.generateAsync({ type: "blob" });

  // Offer automatic download of the generated SB3
  try {
    /*const downloadName = `turbogit-${Date.now()}.sb3`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log("[TurboGit] SB3 download initiated:", downloadName);
    */
    
    // Commented out the automatic download to avoid issues in some browsers, but this can be re-enabled if desired.
  } catch (err) {
    console.warn("[TurboGit] automatic SB3 download failed", err);
  }

  //
  // === IMPORT ===
  //
  // Convert blob → ArrayBuffer (for loading into the VM)
  const arrayBuffer = await blob.arrayBuffer();
  console.log("[TurboGit] arrayBuffer size:", arrayBuffer.byteLength);
  console.log("[TurboGit] SB3 compiled, loading into VM...");

  // Load into TurboWarp VM
  await vm.loadProject(arrayBuffer);

  console.log("[TurboGit] SB3 compiled and loaded into VM.");
}

//HELPER FUNCTIONS
async function logDirectoryContents(dirHandle, path) {
  const entries = [];
  try {
    for await (const [name, handle] of dirHandle.entries()) {
      entries.push(`${name} (${handle.kind})`);
    }
  } catch (err) {
    console.error(`[TurboGit] failed to list contents of ${path}`);
    throw err;
  }
  console.log(`[TurboGit] contents of ${path}:`, entries);
  return entries;
}

async function getDirectoryHandleWithDebug(parent, name, path) {
  console.log(`[TurboGit] getDirectoryHandle ${path}`);
  try {
    const handle = await parent.getDirectoryHandle(name);
    console.log(`[TurboGit] found directory ${path}`);
    return handle;
  } catch (err) {
    console.error(`[TurboGit] missing directory ${path}`);
    await logDirectoryContents(parent, path);
    throw err;
  }
}

async function getFileHandleWithDebug(parent, name, path) {
  console.log(`[TurboGit] getFileHandle ${path}`);
  try {
    const handle = await parent.getFileHandle(name);
    console.log(`[TurboGit] found file ${path}`);
    return handle;
  } catch (err) {
    console.error(`[TurboGit] missing file ${path}`);
    await logDirectoryContents(parent, path);
    throw err;
  }
}

async function readTextFile(dirHandle, name, path = name) {
  console.log(`[TurboGit] readTextFile ${path}`);
  try {
    const fileHandle = await getFileHandleWithDebug(dirHandle, name, path);
    const file = await fileHandle.getFile();
    const text = await file.text();
    console.log(`[TurboGit] readTextFile success ${path}`);
    return text;
  } catch (err) {
    console.error(`[TurboGit] readTextFile failed ${path}`);
    throw err;
  }
}

async function readBinaryFile(dirHandle, name, path = name) {
  console.log(`[TurboGit] readBinaryFile ${path}`);
  try {
    const fileHandle = await getFileHandleWithDebug(dirHandle, name, path);
    const file = await fileHandle.getFile();
    const data = new Uint8Array(await file.arrayBuffer());
    console.log(`[TurboGit] readBinaryFile success ${path}`);
    return data;
  } catch (err) {
    console.error(`[TurboGit] readBinaryFile failed ${path}`);
    throw err;
  }
}

async function getOrCreateDir(parent, name) {
  return await parent.getDirectoryHandle(name, { create: true });
}

async function getDirIfExists(parent, name) {
  try {
    return await parent.getDirectoryHandle(name, { create: false });
  } catch {
    return null;
  }
}

async function getFileIfExists(parent, name) {
  try {
    return await parent.getFileHandle(name, { create: false });
  } catch {
    return null;
  }
}

async function listDirs(dirHandle) {
  const out = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory") {
      out.push({ name, handle });
    }
  }
  return out;
}

async function listFiles(dirHandle) {
  const out = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      out.push({ name, handle });
    }
  }
  return out;
}

async function writeTextFile(dirHandle, name, text) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function writeBinaryFile(dirHandle, name, uint8Array) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(uint8Array);
  await writable.close();
}

async function loadTargetVariables(spriteDir, spriteName) {
  const variablesFileHandle = await getFileIfExists(spriteDir, "variables.json");
  if (!variablesFileHandle) {
    return { targetVariables: {}, targetBroadcasts: {} };
  }

  const file = await variablesFileHandle.getFile();
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn(
      `[TurboGit] invalid variables.json for ${spriteName}, ignoring`,
      err,
    );
    return { targetVariables: {}, targetBroadcasts: {} };
  }

  if (!parsed || typeof parsed !== "object") {
    console.warn(
      `[TurboGit] variables.json for ${spriteName} did not contain an object, ignoring`,
    );
    return { targetVariables: {}, targetBroadcasts: {} };
  }

  const targetVariables = {};
  const targetBroadcasts = {};

  for (const [id, item] of Object.entries(parsed)) {
    if (Array.isArray(item)) {
      targetVariables[id] = [item[0], item[1]];
      continue;
    }

    if (item && typeof item === "object") {
      if (item.type === "broadcast_msg") {
        targetBroadcasts[id] = item.value ?? item.name;
      } else {
        targetVariables[id] = [item.name ?? id, item.value];
      }
    }
  }

  return { targetVariables, targetBroadcasts };
}

async function deleteDirRecursive(dirHandle) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      await dirHandle.removeEntry(name);
    } else if (handle.kind === "directory") {
      await deleteDirRecursive(handle);
      await dirHandle.removeEntry(name, { recursive: true });
    }
  }
}

async function fileExists(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(parentHandle, name) {
  try {
    await parentHandle.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

function md5(data) {
  function md5cycle(x, k) {
    let a = x[0],
      b = x[1],
      c = x[2],
      d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
  }
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function add32(a, b) {
    return (a + b) & 0xffffffff;
  }

  function md51(s) {
    let i,
      n = s.length,
      state = [1732584193, -271733879, -1732584194, 271733878];
    for (i = 64; i <= s.length; i += 64)
      md5cycle(state, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    let tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++)
      tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (let j = 0; j < 16; j++) tail[j] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }

  function md5blk(s) {
    let md5blks = [];
    for (let i = 0; i < 64; i += 4)
      md5blks[i >> 2] =
        s.charCodeAt(i) +
        (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) +
        (s.charCodeAt(i + 3) << 24);
    return md5blks;
  }

  function rhex(n) {
    let s = "",
      j = 0;
    for (; j < 4; j++)
      s +=
        "0123456789abcdef"[(n >> (j * 8 + 4)) & 0x0f] +
        "0123456789abcdef"[(n >> (j * 8)) & 0x0f];
    return s;
  }

  function hex(x) {
    for (let i = 0; i < x.length; i++) x[i] = rhex(x[i]);
    return x.join("");
  }

  // Convert Uint8Array to string, then hash
  let s = "";
  const view = new Uint8Array(data);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return hex(md51(s));
}
