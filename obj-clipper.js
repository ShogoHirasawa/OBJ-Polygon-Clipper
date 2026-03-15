const fs = require('fs');
const readline = require('readline');
const path = require('path');

/**
 * XZ平面上のポリゴン内にある頂点を含む面だけを抽出してOBJ出力
 */
async function clipAndExport(inputPath, polygon, outputPath, onProgress, yMin = -Infinity, yMax = Infinity) {
  // polygon: [{x, z}, ...], yMin/yMax: height range

  // Pass 1: 全頂点のXZ座標を取得して内外判定（＋高さ範囲）
  if (onProgress) onProgress({ phase: 'scanning', percent: 0 });

  const stat = fs.statSync(inputPath);
  const fileSize = stat.size;
  let bytesRead = 0;

  const verticesInside = []; // boolean per vertex (1-indexed, index 0 unused)
  verticesInside.push(false); // dummy for 0-index

  const stream1 = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const rl1 = readline.createInterface({ input: stream1, crlfDelay: Infinity });

  for await (const line of rl1) {
    bytesRead += Buffer.byteLength(line, 'utf-8') + 1;
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      verticesInside.push(pointInPolygon(x, z, polygon) && y >= yMin && y <= yMax);
    }
    if (verticesInside.length % 500000 === 0 && onProgress) {
      onProgress({ phase: 'scanning', percent: Math.round((bytesRead / fileSize) * 50) });
    }
  }

  const insideCount = verticesInside.filter(Boolean).length;
  if (onProgress) onProgress({ phase: 'scanning', percent: 50, insideCount });

  if (insideCount === 0) {
    throw new Error('選択範囲内に頂点がありません');
  }

  // Build vertex remap
  const remap = new Int32Array(verticesInside.length).fill(-1);
  let newIdx = 1;
  for (let i = 1; i < verticesInside.length; i++) {
    if (verticesInside[i]) {
      remap[i] = newIdx++;
    }
  }

  // Pass 2: ストリーム出力
  if (onProgress) onProgress({ phase: 'exporting', percent: 50 });
  bytesRead = 0;

  const out = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  out.write(`# Clipped OBJ - OBJ Polygon Clipper\n`);
  out.write(`# Original: ${path.basename(inputPath)}\n`);
  out.write(`# Polygon: ${polygon.length} vertices\n\n`);

  const stream2 = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const rl2 = readline.createInterface({ input: stream2, crlfDelay: Infinity });

  let vIdx = 0;
  let vtIdx = 0;
  let vnIdx = 0;
  // vt/vn も使われているものだけ出力するため、リマップが必要
  // 簡易版: vt/vnは全部出力し、インデックスはそのまま
  // → 面の頂点が全部insideの場合のみ面を出力
  let writtenFaces = 0;

  for await (const line of rl2) {
    bytesRead += Buffer.byteLength(line, 'utf-8') + 1;

    if (line.startsWith('v ')) {
      vIdx++;
      if (remap[vIdx] > 0) {
        out.write(line + '\n');
      }
    } else if (line.startsWith('vt ') || line.startsWith('vn ')) {
      out.write(line + '\n');
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      let allInside = true;
      const newParts = [];

      for (const p of parts) {
        const comps = p.split('/');
        const vi = parseInt(comps[0]);
        if (remap[vi] < 0) {
          allInside = false;
          break;
        }
        comps[0] = String(remap[vi]);
        newParts.push(comps.join('/'));
      }

      if (allInside) {
        out.write('f ' + newParts.join(' ') + '\n');
        writtenFaces++;
      }
    } else if (line.startsWith('mtllib ')) {
      // MTLファイル名を出力ファイルに合わせる
      const clippedMtl = path.basename(outputPath, '.obj') + '.mtl';
      out.write('mtllib ' + clippedMtl + '\n');
    } else if (line.startsWith('usemtl ') ||
               line.startsWith('g ') || line.startsWith('o ') || line.startsWith('#')) {
      out.write(line + '\n');
    }

    if (bytesRead % 5000000 < 200 && onProgress) {
      onProgress({ phase: 'exporting', percent: 50 + Math.round((bytesRead / fileSize) * 50) });
    }
  }

  out.end();

  // MTLファイルとテクスチャをコピー
  const inputDir = path.dirname(inputPath);
  const outputDir = path.dirname(outputPath);

  // MTLファイルをコピー
  const mtlName = path.basename(inputPath, '.obj') + '.mtl';
  const srcMtl = path.join(inputDir, mtlName);
  if (fs.existsSync(srcMtl)) {
    const dstMtl = path.join(outputDir, path.basename(outputPath, '.obj') + '.mtl');
    fs.copyFileSync(srcMtl, dstMtl);
    // OBJ内のmtllib参照も更新が必要だが、既に元のmtllib行をそのまま出力している
    // → 出力OBJのmtllib行を正しいファイル名に書き換える
  }

  // texフォルダをコピー
  const srcTex = path.join(inputDir, 'tex');
  const dstTex = path.join(outputDir, 'tex');
  if (fs.existsSync(srcTex) && !fs.existsSync(dstTex)) {
    copyDirSync(srcTex, dstTex);
  }

  if (onProgress) onProgress({ phase: 'done', percent: 100, writtenFaces });
  return { writtenFaces };
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function pointInPolygon(x, z, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

module.exports = { clipAndExport };
