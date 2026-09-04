// Small dependency-free linear algebra helpers used by the reconstruction pipeline.

export type Mat3 = number[]; // row-major, length 9

export function matMul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

export function matT3(a: Mat3): Mat3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function matVec3(a: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * Jacobi eigenvalue decomposition for a symmetric n x n matrix (row-major).
 * Returns eigenvalues (descending) and the matching eigenvectors as columns of V.
 */
export function jacobiEigen(
  input: number[],
  n: number,
  sweeps = 60,
): { values: number[]; vectors: number[] } {
  const a = input.slice();
  const v = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;

  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off < 1e-20) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p * n + p];
        const aqq = a[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({ value: a[i * n + i], idx: i }));
  pairs.sort((x, y) => y.value - x.value);
  const values = pairs.map((p) => p.value);
  const vectors = new Array<number>(n * n).fill(0);
  pairs.forEach((p, col) => {
    for (let r = 0; r < n; r++) vectors[r * n + col] = v[r * n + p.idx];
  });
  return { values, vectors };
}

/** Null-space vector (smallest singular value) of an m x n matrix, row-major. */
export function nullSpace(A: number[], m: number, n: number): number[] {
  const ata = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let r = 0; r < m; r++) s += A[r * n + i] * A[r * n + j];
      ata[i * n + j] = s;
      ata[j * n + i] = s;
    }
  }
  const { vectors } = jacobiEigen(ata, n);
  const out = new Array<number>(n);
  for (let r = 0; r < n; r++) out[r] = vectors[r * n + (n - 1)];
  return out;
}

/** SVD of a 3x3 matrix: A = U * diag(S) * V^T, singular values descending. */
export function svd3(A: Mat3): { U: Mat3; S: number[]; V: Mat3 } {
  const ata = matMul3(matT3(A), A);
  const { values, vectors } = jacobiEigen(ata, 3);
  const S = values.map((x) => Math.sqrt(Math.max(0, x)));
  const V = vectors as Mat3;

  // U columns = A * v_i / s_i
  const U: Mat3 = new Array<number>(9).fill(0);
  const cols: [number, number, number][] = [];
  for (let c = 0; c < 3; c++) {
    const vi: [number, number, number] = [V[c], V[3 + c], V[6 + c]];
    const av = matVec3(A, vi);
    const s = S[c];
    if (s > 1e-12) cols.push([av[0] / s, av[1] / s, av[2] / s]);
    else cols.push([0, 0, 0]);
  }
  // Fill degenerate columns with an orthogonal complement.
  for (let c = 0; c < 3; c++) {
    const norm = Math.hypot(...cols[c]);
    if (norm < 1e-9) {
      const a = cols[(c + 1) % 3];
      const b = cols[(c + 2) % 3];
      cols[c] = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    }
  }
  for (let c = 0; c < 3; c++) {
    const n = Math.hypot(...cols[c]) || 1;
    U[c] = cols[c][0] / n;
    U[3 + c] = cols[c][1] / n;
    U[6 + c] = cols[c][2] / n;
  }
  return { U, S, V };
}

export function normalizeVec(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
