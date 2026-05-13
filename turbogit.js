//shared
const root = await window.showDirectoryPicker();

//exportProject(vm) - Exports all original sprites from the VM to the selected folder
async function exportProject(vm) {
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
    await blocksWritable.write(JSON.stringify(blocksObj, null, 2));
    await blocksWritable.close();

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
    await costumeMetaWritable.write(JSON.stringify(costumeMeta, null, 2));
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
    await soundMetaWritable.write(JSON.stringify(soundMeta, null, 2));
    await soundMetaWritable.close();
  }

  console.log("Export complete!");
}

//pullFromFolder(vm) - Pulls sprites from the selected folder into the VM, replacing existing sprites with the same name
async function pullFromFolder(vm) {
  // 2. List sprite folders on disk
  const folderSprites = await listDirs(root);
  const folderNames = folderSprites.map((s) => s.name);
  // 3. List original sprites in VM
  const vmSprites = vm.runtime.targets.filter((t) => t.isOriginal);
  const vmNames = vmSprites.map((t) => t.sprite.name);
  //
  // === DELETE SPRITES THAT NO LONGER EXIST ON DISK ===
  //
  for (const target of vmSprites) {
    const name = target.sprite.name;
    if (!folderNames.includes(name)) {
      console.log("Deleting VM sprite (missing on disk):", name);
      vm.deleteSprite(target.id);
    }
  }
  //
  // === LOAD OR RELOAD SPRITES FROM DISK ===
  //
  for (const { name: spriteName, handle: spriteDir } of folderSprites) {
    console.log("Loading sprite:", spriteName);
    //
    // === LOAD BLOCKS ===
    //
    const blocksText = await readTextFile(spriteDir, "blocks.json");
    const { blocks, scripts } = JSON.parse(blocksText);
    //
    // === LOAD COSTUMES ===
    //
    const costumesDir = await spriteDir.getDirectoryHandle("costumes");
    const costumeMeta = JSON.parse(
      await readTextFile(costumesDir, "costumes.json"),
    );
    const costumes = [];
    for (const meta of costumeMeta) {
      const filename = `${meta.name}.${meta.dataFormat}`;
      const data = await readBinaryFile(costumesDir, filename);
      const assetId = await md5(data);
      // Convert Uint8Array to string for SVGs (VM expects string data for SVG assets)
      let assetData;
      if (meta.dataFormat === "svg") {
        assetData = new TextDecoder().decode(data);
      } else {
        assetData = data;
      }
      costumes.push({
        assetId,
        md5ext: `${assetId}.${meta.dataFormat}`,
        dataFormat: meta.dataFormat,
        name: meta.name,
        rotationCenterX: meta.rotationCenterX,
        rotationCenterY: meta.rotationCenterY,
        asset: { data: assetData },
        bitmapResolution:
          meta.bitmapResolution || (meta.dataFormat === "svg" ? 1 : 2),
      });
    }
    //
    // === LOAD SOUNDS ===
    //
    const soundsDir = await spriteDir.getDirectoryHandle("sounds");
    const soundMeta = JSON.parse(await readTextFile(soundsDir, "sounds.json"));
    const sounds = [];
    for (const meta of soundMeta) {
      let data, ext;
      try {
        ext = "wav";
        data = await readBinaryFile(soundsDir, `${meta.name}.wav`);
      } catch {
        ext = "mp3";
        data = await readBinaryFile(soundsDir, `${meta.name}.mp3`);
      }
      const assetId = await md5(data);
      sounds.push({
        assetId,
        md5ext: `${assetId}.${ext}`,
        dataFormat: ext,
        name: meta.name,
        rate: meta.rate,
        sampleCount: meta.sampleCount,
      });
    }
    //
    // === BUILD TARGET JSON ===
    //
    const targetJSON = {
      isStage: false,
      name: spriteName,
      variables: {},
      lists: {},
      broadcasts: {},
      blocks,
      comments: {},
      currentCostume: 0,
      costumes,
      sounds,
      volume: 100,
      layerOrder: 1,
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: "all around",
    };
    //
    // === REPLACE EXISTING SPRITE IF PRESENT ===
    //
    const existing = vm.runtime.targets.find(
      (t) => t.isOriginal && t.sprite.name === spriteName,
    );
    if (existing) {
      if (spriteName === "Stage") {
        console.log("Mutating Stage instead of deleting it");
        // Replace blocks
        existing.sprite.blocks._blocks = blocks;
        existing.sprite.blocks._scripts = scripts;
        // Replace costumes
        existing.sprite.costumes.length = 0;
        for (const c of costumes) existing.sprite.costumes.push(c);
        // Replace sounds
        existing.sprite.sounds.length = 0;
        for (const s of sounds) existing.sprite.sounds.push(s);
      } else {
        console.log("Replacing existing VM sprite:", spriteName);
        vm.deleteSprite(existing.id);
        await vm.addSprite(targetJSON);
        // Patch assets onto the newly added sprite's costumes
        const added = vm.runtime.targets.find(
          (t) => t.isOriginal && t.sprite.name === spriteName,
        );
        if (added) {
          added.sprite.costumes.forEach((costume, i) => {
            if (costumes[i] && costumes[i].asset) {
              costume.asset = costumes[i].asset;
            }
          });
        }
      }
    } else {
      await vm.addSprite(targetJSON);
    }
    console.log("Loaded:", spriteName);
  }
  console.log("PULL COMPLETE");
}

//HELPER FUNCTIONS
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

async function readTextFile(dirHandle, name) {
  const fileHandle = await dirHandle.getFileHandle(name);
  const file = await fileHandle.getFile();
  return await file.text();
}

async function readBinaryFile(dirHandle, name) {
  const fileHandle = await dirHandle.getFileHandle(name);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
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
