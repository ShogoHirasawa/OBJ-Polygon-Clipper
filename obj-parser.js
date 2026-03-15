const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * MTLファイルをパースしてマテリアル名→テクスチャパスのマップを返す
 */
function parseMTL(mtlPath) {
  if (!fs.existsSync(mtlPath)) return {};
  const text = fs.readFileSync(mtlPath, 'utf-8');
  const materials = {};
  let current = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('newmtl ')) {
      current = trimmed.substring(7).trim();
      materials[current] = {};
    } else if (current && trimmed.startsWith('map_Kd ')) {
      materials[current].map = trimmed.substring(7).trim();
    } else if (current && trimmed.startsWith('d ')) {
      materials[current].opacity = parseFloat(trimmed.substring(2));
    } else if (current && trimmed.startsWith('Kd ')) {
      const parts = trimmed.split(/\s+/);
      materials[current].color = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
    }
  }
  return materials;
}

/**
 * OBJファイルをパースしてマテリアル別のジオメトリデータを返す
 */
async function parseOBJ(filePath, onProgress) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  let bytesRead = 0;

  // Find and parse MTL
  const objDir = path.dirname(filePath);
  let mtlFile = null;
  let materials = {};

  const positions = [];
  const normals = [];
  const uvs = [];

  // Material groups: materialName → [face vertices]
  const materialFaces = new Map();
  let currentMaterial = '__default__';
  materialFaces.set(currentMaterial, []);

  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineCount = 0;

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf-8') + 1;
    lineCount++;

    if (lineCount % 200000 === 0 && onProgress) {
      onProgress({ phase: 'parsing', percent: Math.round((bytesRead / fileSize) * 100) });
    }

    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (line.startsWith('vn ')) {
      const parts = line.split(/\s+/);
      normals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (line.startsWith('vt ')) {
      const parts = line.split(/\s+/);
      uvs.push(parseFloat(parts[1]), parseFloat(parts[2]));
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      const faceVerts = [];
      for (const p of parts) {
        const indices = p.split('/');
        faceVerts.push({
          v: parseInt(indices[0]) - 1,
          vt: indices[1] ? parseInt(indices[1]) - 1 : -1,
          vn: indices[2] ? parseInt(indices[2]) - 1 : -1,
        });
      }
      const arr = materialFaces.get(currentMaterial);
      for (let i = 1; i < faceVerts.length - 1; i++) {
        arr.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
      }
    } else if (line.startsWith('usemtl ')) {
      currentMaterial = line.substring(7).trim();
      if (!materialFaces.has(currentMaterial)) {
        materialFaces.set(currentMaterial, []);
      }
    } else if (line.startsWith('mtllib ')) {
      mtlFile = line.substring(7).trim();
      const mtlPath = path.join(objDir, mtlFile);
      materials = parseMTL(mtlPath);
    }
  }

  if (onProgress) onProgress({ phase: 'building', percent: 0 });

  const hasNormals = normals.length > 0;
  const hasUVs = uvs.length > 0;

  // Build per-material geometry
  const meshGroups = [];
  let processedVerts = 0;
  let totalVerts = 0;
  for (const [, faces] of materialFaces) totalVerts += faces.length;

  for (const [matName, faces] of materialFaces) {
    if (faces.length === 0) continue;

    const vertCount = faces.length;
    const posArray = new Float32Array(vertCount * 3);
    const normArray = hasNormals ? new Float32Array(vertCount * 3) : null;
    const uvArray = hasUVs ? new Float32Array(vertCount * 2) : null;

    for (let i = 0; i < vertCount; i++) {
      const f = faces[i];
      posArray[i * 3] = positions[f.v * 3];
      posArray[i * 3 + 1] = positions[f.v * 3 + 1];
      posArray[i * 3 + 2] = positions[f.v * 3 + 2];

      if (hasNormals && f.vn >= 0) {
        normArray[i * 3] = normals[f.vn * 3];
        normArray[i * 3 + 1] = normals[f.vn * 3 + 1];
        normArray[i * 3 + 2] = normals[f.vn * 3 + 2];
      }
      if (hasUVs && f.vt >= 0) {
        uvArray[i * 2] = uvs[f.vt * 2];
        uvArray[i * 2 + 1] = uvs[f.vt * 2 + 1];
      }

      processedVerts++;
      if (processedVerts % 500000 === 0 && onProgress) {
        onProgress({ phase: 'building', percent: Math.round((processedVerts / totalVerts) * 100) });
      }
    }

    // Resolve texture path
    let texturePath = null;
    if (materials[matName] && materials[matName].map) {
      const texFile = path.join(objDir, materials[matName].map);
      if (fs.existsSync(texFile)) {
        texturePath = texFile;
      }
    }

    meshGroups.push({
      materialName: matName,
      positions: posArray.buffer,
      normals: normArray ? normArray.buffer : null,
      uvs: uvArray ? uvArray.buffer : null,
      vertexCount: vertCount,
      texturePath,
    });
  }

  // Bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  if (onProgress) onProgress({ phase: 'done', percent: 100 });

  return {
    meshGroups,
    totalVertexCount: totalVerts,
    triangleCount: totalVerts / 3,
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
  };
}

module.exports = { parseOBJ };
