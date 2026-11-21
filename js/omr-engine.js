/**
 * OMR Engine - Optical Mark Recognition 2025+ GDPT
 * Nhận diện thị giác máy tính chính xác theo chuẩn phiếu Bộ GD&ĐT:
 * - Vùng 1: Số báo danh 8 chữ số (chuỗi padding 0)
 * - Vùng 2: Mã đề 4 chữ số
 * - Vùng 3 (Phần I): 40 câu trắc nghiệm nhiều lựa chọn (4 cột x 10 câu x 4 phương án A, B, C, D)
 * - Vùng 4 (Phần II): 8 câu trắc nghiệm Đúng/Sai (4 khối x 2 câu x 4 ý a, b, c, d x 2 lựa chọn Đ, S)
 * - Vùng 5 (Phần III): 6 câu trắc nghiệm trả lời ngắn (6 khối x 4 cột x 12 dòng -, ,, 0-9)
 */
class OMREngine {
  constructor() {
    this.audioCtx = null;
  }

  // Phát âm thanh bíp khi chấm xong
  playBeep(isSuccess = true) {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      
      if (isSuccess) {
        osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5
        osc.frequency.setValueAtTime(1174.66, this.audioCtx.currentTime + 0.08); // D6
        gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.22);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.22);
      } else {
        osc.frequency.setValueAtTime(320, this.audioCtx.currentTime);
        osc.frequency.setValueAtTime(240, this.audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.3);
      }
    } catch (e) {
      console.warn("AudioContext error:", e);
    }
  }

  /**
   * Tính điểm theo thang điểm đã cấu hình
   */
  calculateGrade(scannedData, answerKey, gradingRules) {
    let p1Score = 0;
    let p2Score = 0;
    let p3Score = 0;
    const notes = [];
    const details = {
      p1: [],
      p2: [],
      p3: []
    };

    if (!answerKey) {
      return {
        p1Score: 0,
        p2Score: 0,
        p3Score: 0,
        totalScore: 0,
        notes: "Mã đề " + (scannedData.examCode || "???") + " không tồn tại trong file đáp án!",
        details
      };
    }

    // --- PHẦN I: Trắc nghiệm 4 lựa chọn ---
    const p1Rules = (gradingRules && gradingRules.p1) ? gradingRules.p1 : { type: 'per_question', pointPerQuestion: 0.25 };
    const p1Ans = answerKey.p1 || {};
    const p1TotalQs = Object.keys(p1Ans).length;
    const p1PointPerQ = (p1Rules.type === 'total' && p1Rules.totalPoints) 
      ? (p1TotalQs > 0 ? p1Rules.totalPoints / p1TotalQs : 0.25)
      : (p1Rules.pointPerQuestion || 0.25);

    for (let q = 1; q <= 40; q++) {
      if (!p1Ans[q]) continue;
      const expected = String(p1Ans[q]).trim().toUpperCase();
      const actual = (scannedData.p1 && scannedData.p1[q]) ? String(scannedData.p1[q]).trim().toUpperCase() : "";
      
      let isCorrect = false;
      // Nếu vi phạm quy chế tô đúp (nhiều hơn 1 ô) -> mặc định 0 điểm (Sai)
      if (actual === "ĐÚP" || actual.includes("ĐÚP") || actual.includes(",")) {
        isCorrect = false;
        notes.push(`Câu ${q} (P1) vi phạm tô đúp`);
      } else if (expected === "*" || expected === "ALL") {
        isCorrect = true; // Tặng điểm
      } else if (expected.includes(",") || expected.includes("/")) {
        const validOpts = expected.split(/[,/]/).map(s => s.trim());
        isCorrect = validOpts.includes(actual);
      } else {
        isCorrect = (actual === expected && actual !== "");
      }

      if (isCorrect) {
        p1Score += p1PointPerQ;
      }

      const isAmbiguous = (scannedData.p1Ambiguous && scannedData.p1Ambiguous[q]) || actual === "ĐÚP";

      details.p1.push({
        q,
        expected,
        actual: actual === "ĐÚP" ? "Tô đúp" : actual,
        isCorrect,
        isAmbiguous
      });
    }

    // --- PHẦN II: Đúng / Sai ---
    const p2Rules = (gradingRules && gradingRules.p2) ? gradingRules.p2 : { mode: 'standard', maxPointPerQuestion: 1.0 };
    const p2Ans = answerKey.p2 || {};
    const p2Keys = Object.keys(p2Ans).map(Number).sort((a, b) => a - b);

    p2Keys.forEach((stt, idx) => {
      const expectedStr = String(p2Ans[stt]).trim().toUpperCase();
      const expectedItems = expectedStr.replace(/[^DS]/g, '').split('');
      
      let rawActual = (scannedData.p2 && (scannedData.p2[stt] !== undefined ? scannedData.p2[stt] : scannedData.p2[idx + 1])) 
        ? (scannedData.p2[stt] !== undefined ? scannedData.p2[stt] : scannedData.p2[idx + 1]) 
        : [];
      
      // Chuẩn hóa actualItems thành dạng mảng 4 phần tử ['D','S','D','S']
      let actualItems = [];
      if (Array.isArray(rawActual)) {
        actualItems = rawActual.map(x => String(x || '').trim().toUpperCase().replace('Đ', 'D'));
      } else if (typeof rawActual === 'object') {
        actualItems = ['a', 'b', 'c', 'd'].map(k => String(rawActual[k] || '').trim().toUpperCase().replace('Đ', 'D'));
      }

      let correctCount = 0;
      const subItems = [];
      const labels = ['a', 'b', 'c', 'd'];

      for (let i = 0; i < 4; i++) {
        const exp = expectedItems[i] || "";
        const act = actualItems[i] || "";
        // Nếu act là 'X' (tô đúp cả Đúng lẫn Sai) thì mặc định SAI
        const isOk = (act !== 'X' && act !== 'ĐÚP' && act === exp && act !== "") || (exp === "*");
        if (isOk) correctCount++;
        subItems.push({ 
          item: labels[i], 
          expected: exp === 'D' ? 'Đ' : (exp === 'S' ? 'S' : exp), 
          actual: act === 'X' ? 'Đ,S (Đúp)' : (act === 'D' ? 'Đ' : (act === 'S' ? 'S' : (act || '-'))), 
          isCorrect: isOk 
        });
      }

      let qPoint = 0;
      if (p2Rules.mode === 'standard') {
        if (correctCount === 1) qPoint = 0.1;
        else if (correctCount === 2) qPoint = 0.25;
        else if (correctCount === 3) qPoint = 0.5;
        else if (correctCount === 4) qPoint = 1.0;
        qPoint *= (p2Rules.maxPointPerQuestion || 1.0);
      } else {
        const ptPerItem = p2Rules.pointPerItem !== undefined ? parseFloat(p2Rules.pointPerItem) : 0.25;
        qPoint = correctCount * ptPerItem;
      }

      p2Score += qPoint;

      details.p2.push({
        q: stt,
        sheetQ: idx + 1,
        expected: expectedStr.replace(/D/g, 'Đ'),
        actual: subItems.map(s => s.actual).join('-'),
        correctCount,
        qPoint,
        subItems
      });
    });

    // --- PHẦN III: Trả lời ngắn ---
    const p3Rules = (gradingRules && gradingRules.p3) ? gradingRules.p3 : { pointPerQuestion: 0.5 };
    const p3Ans = answerKey.p3 || {};
    const p3Keys = Object.keys(p3Ans).map(Number).sort((a, b) => a - b);

    p3Keys.forEach((stt, idx) => {
      const rawExp = String(p3Ans[stt] || "").trim();
      const actual = (scannedData.p3 && (scannedData.p3[stt] !== undefined ? scannedData.p3[stt] : scannedData.p3[idx + 1])) 
        ? String(scannedData.p3[stt] !== undefined ? scannedData.p3[stt] : scannedData.p3[idx + 1]).trim() 
        : "";

      let isCorrect = false;
      let displayActual = actual || "—";

      // Nếu vi phạm quy chế tô đúp ở bất kỳ cột nào -> 0 điểm (Sai)
      if (actual.startsWith("ĐÚP") || actual.includes("ĐÚP")) {
        isCorrect = false;
        const colNum = actual.replace("ĐÚP_C", "");
        displayActual = `Tô đúp Cột ${colNum}`;
        notes.push(`Câu ${stt} (P3) vi phạm tô đúp Cột ${colNum}`);
      } else if (rawExp === "*" || rawExp === "ALL") {
        isCorrect = true;
      } else {
        // Tách các phương án chấp nhận được qua dấu / hoặc ;
        const candidates = rawExp.split(/[/;]/).map(s => s.trim());
        // Chuẩn hóa quy định của Bộ GD&ĐT:
        // Chỉ phân biệt dấu . hay , (cả . và , đều xem là tương đương).
        // Thí sinh tô từ trái sang phải, không được viết 05 thay 5, không được viết 5,0 thay 5.
        const normAct = actual.replace(/,/g, '.').replace(/\s+/g, '');
        isCorrect = candidates.some(cand => {
          const normExp = cand.replace(/,/g, '.').replace(/\s+/g, '');
          if (!normAct || !normExp) return false;
          return normAct === normExp;
        });
      }

      if (isCorrect) {
        p3Score += (p3Rules.pointPerQuestion || 0.5);
      }

      details.p3.push({
        q: stt,
        sheetQ: idx + 1,
        expected: rawExp,
        actual: displayActual,
        rawActual: actual,
        isCorrect
      });
    });

    // Làm tròn 2 chữ số thập phân
    p1Score = Math.round(p1Score * 100) / 100;
    p2Score = Math.round(p2Score * 100) / 100;
    p3Score = Math.round(p3Score * 100) / 100;
    const totalScore = Math.round((p1Score + p2Score + p3Score) * 100) / 100;

    return {
      p1Score,
      p2Score,
      p3Score,
      totalScore,
      notes: notes.join("; "),
      details
    };
  }

  /**
   * Xoay canvas theo góc chỉ định (90, 180, 270 độ)
   */
  rotateCanvas(canvas, degrees) {
    const rot = document.createElement('canvas');
    if (degrees === 90 || degrees === 270) {
      rot.width = canvas.height;
      rot.height = canvas.width;
    } else {
      rot.width = canvas.width;
      rot.height = canvas.height;
    }
    const ctx = rot.getContext('2d');
    ctx.translate(rot.width / 2, rot.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return rot;
  }

  /**
   * Dò tìm 1 ô vuông đen định vị trong vùng góc phần tư
   */
  findCornerMarkerInRegion(imgData, W, H, xMin, xMax, yMin, yMax) {
    function getGray(x, y) {
      if (x < 0 || x >= W || y < 0 || y >= H) return 255;
      const i = (y * W + x) * 4;
      return (imgData[i] * 299 + imgData[i + 1] * 587 + imgData[i + 2] * 114) / 1000;
    }

    const boxSize = Math.max(14, Math.round(W * 0.021));
    const half = Math.floor(boxSize / 2);

    let bestVal = 999;
    let bestX = 0, bestY = 0;

    // Bước 1: Quét thô tìm khối vuông tối nhất
    for (let y = yMin; y <= yMax - boxSize; y += 3) {
      for (let x = xMin; x <= xMax - boxSize; x += 3) {
        let sum = 0, cnt = 0;
        for (let dy = 0; dy < boxSize; dy += 3) {
          for (let dx = 0; dx < boxSize; dx += 3) {
            sum += getGray(x + dx, y + dy);
            cnt++;
          }
        }
        const avg = sum / cnt;
        if (avg < bestVal) {
          bestVal = avg;
          bestX = x + half;
          bestY = y + half;
        }
      }
    }

    if (bestX === 0 || bestY === 0) return null;

    // Bước 2: Tinh chỉnh xung quanh điểm tối nhất
    let fineVal = 999, fineX = bestX, fineY = bestY;
    for (let y = bestY - 8; y <= bestY + 8; y += 1) {
      for (let x = bestX - 8; x <= bestX + 8; x += 1) {
        let sum = 0, cnt = 0;
        for (let dy = -half; dy <= half; dy += 2) {
          for (let dx = -half; dx <= half; dx += 2) {
            sum += getGray(x + dx, y + dy);
            cnt++;
          }
        }
        const avg = sum / cnt;
        if (avg < fineVal) {
          fineVal = avg;
          fineX = x;
          fineY = y;
        }
      }
    }

    // Bước 3: Tính trọng tâm (center of mass) của các pixel đen
    let sumX = 0, sumY = 0, totalWeight = 0;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const g = getGray(fineX + dx, fineY + dy);
        const w = Math.max(0, 200 - g);
        sumX += (fineX + dx) * w;
        sumY += (fineY + dy) * w;
        totalWeight += w;
      }
    }

    if (totalWeight > 0) {
      return { x: sumX / totalWeight, y: sumY / totalWeight };
    }
    return { x: fineX, y: fineY };
  }

  /**
   * Tìm 4 ô vuông đen định vị ở 4 góc của phiếu thi
   */
  find4CornerMarkers(canvas) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, W, H).data;

    // Quét 4 góc phần tư
    const tl = this.findCornerMarkerInRegion(imgData, W, H, 4, Math.round(W * 0.22), 4, Math.round(H * 0.16));
    const tr = this.findCornerMarkerInRegion(imgData, W, H, Math.round(W * 0.78), W - 4, 4, Math.round(H * 0.16));
    const bl = this.findCornerMarkerInRegion(imgData, W, H, 4, Math.round(W * 0.22), Math.round(H * 0.84), H - 4);
    const br = this.findCornerMarkerInRegion(imgData, W, H, Math.round(W * 0.78), W - 4, Math.round(H * 0.84), H - 4);

    if (!tl || !tr || !bl || !br) return null;

    const widthTop = tr.x - tl.x;
    const widthBot = br.x - bl.x;
    const heightLeft = bl.y - tl.y;
    const heightRight = br.y - tr.y;

    // Kiểm tra tính hợp lệ hình học của 4 điểm neo
    if (widthTop < W * 0.55 || widthBot < W * 0.55) return null;
    if (heightLeft < H * 0.55 || heightRight < H * 0.55) return null;

    const avgW = (widthTop + widthBot) / 2;
    const avgH = (heightLeft + heightRight) / 2;
    const ratio = avgH / avgW;
    if (ratio < 1.15 || ratio > 1.75) return null; // Tỉ lệ chuẩn A4 giữa các điểm neo ~ 1.455

    return { tl, tr, br, bl };
  }

  /**
   * Tính ma trận phối cảnh 8 tham số Homography
   */
  getPerspectiveTransform(src, dst) {
    const a = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const sx = src[i].x, sy = src[i].y;
      const dx = dst[i].x, dy = dst[i].y;
      a.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
      b.push(dx);
      a.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
      b.push(dy);
    }
    const n = 8;
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(a[k][i]) > Math.abs(a[maxRow][i])) maxRow = k;
      }
      [a[i], a[maxRow]] = [a[maxRow], a[i]];
      [b[i], b[maxRow]] = [b[maxRow], b[i]];
      for (let k = i + 1; k < n; k++) {
        const factor = a[k][i] / a[i][i];
        for (let j = i; j < n; j++) a[k][j] -= factor * a[i][j];
        b[k] -= factor * b[i];
      }
    }
    const h = new Array(9);
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) sum += a[i][j] * h[j];
      h[i] = (b[i] - sum) / a[i][i];
    }
    h[8] = 1;
    return h;
  }

  /**
   * Nắn phối cảnh (Perspective Warp) đưa 4 góc định vị về khung chuẩn A4 (1662 x 2346)
   */
  warpToStandardA4(srcCanvas, markers) {
    const CANON_W = 1662;
    const CANON_H = 2346;
    const dstQuad = [
      { x: 51.5, y: 39.7 },     // TL
      { x: 1614.5, y: 39.7 },   // TR
      { x: 1614.5, y: 2274.0 }, // BR
      { x: 54.3, y: 2274.0 }    // BL
    ];
    const srcQuad = [markers.tl, markers.tr, markers.br, markers.bl];

    const hInv = this.getPerspectiveTransform(dstQuad, srcQuad);
    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = CANON_W;
    dstCanvas.height = CANON_H;
    const dstCtx = dstCanvas.getContext('2d');
    const dstData = dstCtx.createImageData(CANON_W, CANON_H);

    const srcCtx = srcCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const sW = srcCanvas.width, sH = srcCanvas.height;
    const sD = srcData.data, dD = dstData.data;

    for (let y = 0; y < CANON_H; y++) {
      for (let x = 0; x < CANON_W; x++) {
        const z = hInv[6] * x + hInv[7] * y + hInv[8];
        const sx = (hInv[0] * x + hInv[1] * y + hInv[2]) / z;
        const sy = (hInv[3] * x + hInv[4] * y + hInv[5]) / z;

        const dstIdx = (y * CANON_W + x) * 4;
        if (sx >= 0 && sx < sW - 1 && sy >= 0 && sy < sH - 1) {
          const x0 = Math.floor(sx), x1 = x0 + 1;
          const y0 = Math.floor(sy), y1 = y0 + 1;
          const dx = sx - x0, dy = sy - y0;

          const i00 = (y0 * sW + x0) * 4;
          const i10 = (y0 * sW + x1) * 4;
          const i01 = (y1 * sW + x0) * 4;
          const i11 = (y1 * sW + x1) * 4;

          for (let c = 0; c < 4; c++) {
            const top = sD[i00 + c] * (1 - dx) + sD[i10 + c] * dx;
            const bot = sD[i01 + c] * (1 - dx) + sD[i11 + c] * dx;
            dD[dstIdx + c] = top * (1 - dy) + bot * dy;
          }
        } else {
          dD[dstIdx] = 255;
          dD[dstIdx + 1] = 255;
          dD[dstIdx + 2] = 255;
          dD[dstIdx + 3] = 255;
        }
      }
    }
    dstCtx.putImageData(dstData, 0, 0);
    return dstCanvas;
  }

  /**
   * Tự động phát hiện hướng xoay và căn chỉnh 4 góc về khổ A4 chuẩn
   */
  normalizeToStandardA4(canvas) {
    let candidate = canvas;

    // 1. Nếu ảnh nằm ngang (W > H), thử xoay 90 độ hoặc 270 độ
    if (canvas.width > canvas.height) {
      const rot90 = this.rotateCanvas(canvas, 90);
      const m90 = this.find4CornerMarkers(rot90);
      if (m90) {
        return { canvas: this.warpToStandardA4(rot90, m90), usedWarp: true };
      }
      const rot270 = this.rotateCanvas(canvas, 270);
      const m270 = this.find4CornerMarkers(rot270);
      if (m270) {
        return { canvas: this.warpToStandardA4(rot270, m270), usedWarp: true };
      }
      // Mặc định xoay 90 độ nếu chưa tìm thấy điểm neo
      candidate = rot90;
    }

    // 2. Dò tìm 4 điểm neo ở hướng dọc hiện tại
    const markers = this.find4CornerMarkers(candidate);
    if (markers) {
      return { canvas: this.warpToStandardA4(candidate, markers), usedWarp: true };
    }

    // 3. Nếu chưa thấy, thử xoay ngược 180 độ (phòng trường hợp người dùng cầm ngược máy)
    const rot180 = this.rotateCanvas(candidate, 180);
    const m180 = this.find4CornerMarkers(rot180);
    if (m180) {
      return { canvas: this.warpToStandardA4(rot180, m180), usedWarp: true };
    }

    // Fallback nếu ảnh scan khít mép không có 4 điểm neo bên ngoài
    return { canvas: candidate, usedWarp: false };
  }

  /**
   * Phân tích và trích xuất OMR từ Canvas ảnh chụp
   */
  async processSheetCanvas(canvas, activeExamKeys, studentList, gradingRules) {
    // 1. Tự động chuẩn hóa ảnh theo đúng chiều và nắn 4 góc về khổ A4 chuẩn
    const normalized = this.normalizeToStandardA4(canvas);
    const workingCanvas = normalized.canvas;

    const ctx = workingCanvas.getContext('2d');
    const width = workingCanvas.width;
    const height = workingCanvas.height;

    // 2. Thuật toán thị giác máy tính OMR
    const scanned = this.extractSheetData(ctx, width, height, activeExamKeys, studentList);

    // 3. Tìm đáp án theo mã đề
    const key = (activeExamKeys && activeExamKeys[scanned.examCode]) ? activeExamKeys[scanned.examCode] : null;

    // 4. Tính điểm
    const grading = this.calculateGrade(scanned, key, gradingRules);

    // 5. Đối chiếu danh sách học sinh (SBD 8 số)
    let studentName = "";
    let studentClass = "";
    if (studentList && studentList.length > 0) {
      const cleanSbd = String(scanned.sbd).trim();
      const found = studentList.find(s => String(s.sbd).trim() === cleanSbd);
      if (found) {
        studentName = found.name;
        studentClass = found.className;
      } else {
        studentName = "Học sinh SBD " + cleanSbd;
        studentClass = "Tự do";
        const warning = "SBD không có trong danh sách";
        grading.notes = grading.notes ? `${warning}; ${grading.notes}` : warning;
      }
    } else {
      studentName = "Học sinh SBD " + scanned.sbd;
      studentClass = "Tự do";
    }

    // 6. Lưu ảnh đã nắn thẳng khổ A4 chuẩn (chưa vẽ overlay) để phục vụ chỉnh sửa SBD/Mã đề và chấm lại trực tiếp
    const cleanImageData = workingCanvas.toDataURL('image/jpeg', 0.88);

    // 7. Vẽ đánh dấu trực quan câu đúng/sai lên ảnh
    this.drawOverlayMarks(ctx, width, height, scanned, grading);

    const markedImageData = workingCanvas.toDataURL('image/jpeg', 0.88);

    // 8. Âm thanh bíp thông báo
    this.playBeep(key !== null);

    return {
      id: 'sub_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      sbd: scanned.sbd,
      name: studentName,
      className: studentClass,
      examCode: scanned.examCode,
      p1Score: grading.p1Score,
      p2Score: grading.p2Score,
      p3Score: grading.p3Score,
      totalScore: grading.totalScore,
      notes: grading.notes,
      scannedData: scanned,
      details: grading.details,
      cleanImage: cleanImageData,
      previewImage: markedImageData
    };
  }

  /**
   * Thuật toán OMR thị giác máy tính:
   * Nhận diện chính xác ô tròn tô chì dựa vào độ tương phản tương đối & mật độ quang học
   */
  extractSheetData(ctx, width, height, activeExamKeys, studentList) {
    const W = width;
    const H = height;
    const imgData = ctx.getImageData(0, 0, W, H).data;

    // Lấy độ tối tại điểm (cx, cy): darkness = 255 - gray
    function getDarkness(cx, cy, r = 5) {
      let sum = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            const px = Math.min(W - 1, Math.max(0, Math.floor(cx + dx)));
            const py = Math.min(H - 1, Math.max(0, Math.floor(cy + dy)));
            const i = (py * W + px) * 4;
            const gray = (imgData[i] * 299 + imgData[i + 1] * 587 + imgData[i + 2] * 114) / 1000;
            sum += (255 - gray);
            count++;
          }
        }
      }
      return count > 0 ? sum / count : 0;
    }

    // Dò đỉnh tối đa trong phạm vi bán kính jitter nhỏ
    function getPeakDarkness(cx, cy, r = 5, jitter = 3) {
      let maxD = 0;
      for (let jy = -jitter; jy <= jitter; jy += 2) {
        for (let jx = -jitter; jx <= jitter; jx += 2) {
          const dark = getDarkness(cx + jx, cy + jy, r);
          if (dark > maxD) maxD = dark;
        }
      }
      return maxD;
    }

    // Tỉ lệ scale so với chuẩn A4 mẫu
    const sx = W / 1662.0;
    const sy = H / 2346.0;

    // ==========================================
    // 1. VÙNG 1: SỐ BÁO DANH (8 CHỮ SỐ)
    // ==========================================
    let sbd = "";
    let sbdShadedCols = 0;
    for (let c = 0; c < 8; c++) {
      const cx = (1160 + c * 31.0) * sx;
      const readings = [];
      for (let r = 0; r < 10; r++) {
        const cy = (262 + r * 46.0) * sy;
        readings.push({ digit: r, dark: getPeakDarkness(cx, cy, 5, 4) });
      }
      readings.sort((a, b) => b.dark - a.dark);
      const minD = Math.min(...readings.map(o => o.dark));
      
      const isTopShaded = (readings[0].dark >= 100 && (readings[0].dark - minD) >= 15);
      const isDouble = isTopShaded && (readings[1].dark >= 110 && (readings[1].dark - minD) >= 20 && (readings[0].dark - readings[1].dark < 10));

      if (isDouble) {
        sbd += "X"; // Tô đúp ô trên cùng 1 cột SBD
        sbdShadedCols++;
      } else if (isTopShaded) {
        sbd += String(readings[0].digit);
        sbdShadedCols++;
      } else {
        sbd += "_"; // Cột này không tô
      }
    }
    // Nếu cả 8 cột đều không tô thì để trống để hệ thống báo lỗi chưa tô SBD
    if (sbdShadedCols === 0) {
      sbd = "";
    }

    // ==========================================
    // 2. VÙNG 2: MÃ ĐỀ THI (Tối đa 4 cột: Mã 4 số tô 4 cột, Mã 3 số tô 3 cột đầu)
    // Mỗi cột chỉ được tô tối đa 1 ô
    // ==========================================
    let made = "";
    let madeShadedCols = 0;
    const codeCols = [];

    for (let c = 0; c < 4; c++) {
      const cx = (1442 + c * 31.0) * sx;
      const readings = [];
      for (let r = 0; r < 10; r++) {
        const cy = (262 + r * 46.0) * sy;
        readings.push({ digit: r, dark: getPeakDarkness(cx, cy, 5, 4) });
      }
      readings.sort((a, b) => b.dark - a.dark);
      const minD = Math.min(...readings.map(o => o.dark));

      const isTopShaded = (readings[0].dark >= 100 && (readings[0].dark - minD) >= 15);
      const isDouble = isTopShaded && (readings[1].dark >= 110 && (readings[1].dark - minD) >= 20 && (readings[0].dark - readings[1].dark < 10));

      if (isDouble) {
        // Tô đúp ô trên cùng 1 cột mã đề
        codeCols.push("X");
        madeShadedCols++;
      } else if (isTopShaded) {
        codeCols.push(String(readings[0].digit));
        madeShadedCols++;
      } else {
        codeCols.push("_"); // Cột này không tô
      }
    }

    if (madeShadedCols === 0) {
      made = ""; // Hoàn toàn chưa tô mã đề
    } else if (codeCols.includes("X")) {
      made = codeCols.join(""); // Có vi phạm tô đúp
    } else {
      const c3 = codeCols.slice(0, 3).join("");
      const c4 = codeCols.join("");
      
      const keys = activeExamKeys ? Object.keys(activeExamKeys) : [];
      const has3DigitKeys = keys.some(k => String(k).trim().length === 3);
      const has4DigitKeys = keys.some(k => String(k).trim().length === 4);

      // Nếu tô 3 cột đầu và cột 4 để trống
      if (codeCols[0] !== "_" && codeCols[1] !== "_" && codeCols[2] !== "_" && codeCols[3] === "_") {
        if (has3DigitKeys || (!has4DigitKeys && keys.length === 0)) {
          // Đúng chuẩn mã đề 3 chữ số (tô 3 cột đầu, cột 4 để trống)
          made = c3;
        } else {
          // Kỳ thi dùng mã đề 4 chữ số nhưng học sinh quên tô cột 4
          made = c4;
        }
      } else if (!codeCols.includes("_")) {
        // Tô đủ cả 4 cột -> Mã đề 4 chữ số
        made = c4;
      } else {
        // Tô thiếu cột hoặc ngắt quãng
        made = c4;
      }
    }

    // ==========================================
    // 3. VÙNG 3: PHẦN I (40 CÂU TN 4 LỰA CHỌN)
    // Tự động định vị cục bộ theo đường viền ngang tiêu đề Phần I
    // ==========================================
    let p1LineY = Math.round(801 * sy);
    let maxP1 = -1;
    const p1SearchMin = Math.round(780 * sy);
    const p1SearchMax = Math.round(830 * sy);
    for (let y = p1SearchMin; y <= p1SearchMax; y++) {
      let s = 0;
      for (let x = Math.round(150 * sx); x < Math.round(W - 150 * sx); x += 20) {
        s += getDarkness(x, y, 3);
      }
      if (s > maxP1) { maxP1 = s; p1LineY = y; }
    }
    const deltaYP1 = p1LineY - (801 * sy);

    const p1ColA = [176, 554, 932, 1310];
    const letters = ['A', 'B', 'C', 'D'];
    const p1 = {};
    const p1Ambiguous = {};

    for (let b = 0; b < 4; b++) {
      const startX = p1ColA[b];
      for (let q = 0; q < 10; q++) {
        const qNum = b * 10 + q + 1;
        const cy = (866 + q * 39.3) * sy + deltaYP1;
        const readings = [];
        for (let opt = 0; opt < 4; opt++) {
          const cx = (startX + opt * 66.0) * sx;
          readings.push({ opt: letters[opt], dark: getPeakDarkness(cx, cy, 6, 4) });
        }
        readings.sort((a, b) => b.dark - a.dark);
        const minD = Math.min(...readings.map(o => o.dark));

        // Kiểm tra ô được tô (nếu tô >= 2 ô thì vi phạm quy chế tô đúp)
        const shadedOpts = readings.filter(o => o.dark >= 75 && (o.dark - minD) >= 18);
        if (shadedOpts.length === 1) {
          p1[qNum] = shadedOpts[0].opt;
        } else if (shadedOpts.length >= 2) {
          p1[qNum] = "ĐÚP";
          p1Ambiguous[qNum] = true;
        } else {
          p1[qNum] = ""; // Bỏ trống
        }
      }
    }

    // ==========================================
    // 4. VÙNG 4: PHẦN II (8 CÂU TRẮC NGHIỆM ĐÚNG/SAI)
    // Tự động định vị cục bộ theo đường viền ngang tiêu đề Phần II
    // ==========================================
    let p2LineY = Math.round(1378 * sy);
    let maxP2 = -1;
    const p2SearchMin = Math.round(1340 * sy);
    const p2SearchMax = Math.round(1410 * sy);
    for (let y = p2SearchMin; y <= p2SearchMax; y++) {
      let s = 0;
      for (let x = Math.round(150 * sx); x < Math.round(W - 150 * sx); x += 20) {
        s += getDarkness(x, y, 3);
      }
      if (s > maxP2) { maxP2 = s; p2LineY = y; }
    }
    const deltaYP2 = p2LineY - (1378 * sy);

    const p2 = {};
    for (let b = 0; b < 4; b++) {
      const startX = p1ColA[b];
      const qA = b * 2 + 1;
      const qB = b * 2 + 2;
      p2[qA] = ['-', '-', '-', '-'];
      p2[qB] = ['-', '-', '-', '-'];

      for (let s = 0; s < 4; s++) {
        const cy = (1416 + s * 40.0) * sy + deltaYP2;

        // Câu qA (Đúng ở startX + 4, Sai ở startX + 70)
        const dAD = getPeakDarkness((startX + 4) * sx, cy, 5, 4);
        const dAS = getPeakDarkness((startX + 70) * sx, cy, 5, 4);
        const isAD = dAD >= 75;
        const isAS = dAS >= 75;
        if (isAD && isAS && Math.abs(dAD - dAS) < 22) {
          p2[qA][s] = 'X'; // Vi phạm tô đúp cả Đúng lẫn Sai
        } else if (Math.abs(dAD - dAS) >= 16) {
          p2[qA][s] = dAD > dAS ? 'D' : 'S';
        }

        // Câu qB (Đúng ở startX + 136, Sai ở startX + 202)
        const dBD = getPeakDarkness((startX + 136) * sx, cy, 5, 4);
        const dBS = getPeakDarkness((startX + 202) * sx, cy, 5, 4);
        const isBD = dBD >= 75;
        const isBS = dBS >= 75;
        if (isBD && isBS && Math.abs(dBD - dBS) < 22) {
          p2[qB][s] = 'X'; // Vi phạm tô đúp cả Đúng lẫn Sai
        } else if (Math.abs(dBD - dBS) >= 16) {
          p2[qB][s] = dBD > dBS ? 'D' : 'S';
        }
      }
    }

    // ==========================================
    // 5. VÙNG 5: PHẦN III (6 CÂU TRẢ LỜI NGẮN)
    // Tự động định vị cục bộ theo đường viền ngang tiêu đề Phần III (chuẩn Bộ GD&ĐT)
    // ==========================================
    let p3LineY = Math.round(1697 * sy);
    let maxP3 = -1;
    const p3SearchMin = Math.round(1670 * sy);
    const p3SearchMax = Math.round(1720 * sy);
    for (let y = p3SearchMin; y <= p3SearchMax; y++) {
      let s = 0;
      for (let x = Math.round(150 * sx); x < Math.round(W - 150 * sx); x += 25) {
        s += getDarkness(x, y, 3);
      }
      if (s > maxP3) { maxP3 = s; p3LineY = y; }
    }
    const deltaYP3 = p3LineY - Math.round(1697 * sy);

    const rowStepP3 = 44.5 * sy;
    const colStepP3 = 40.0 * sx;
    const startYP3 = (1734.5 * sy) + deltaYP3;

    const charsP3 = ['-', ',', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const p3 = {};
    const p3Shaded = {}; // Lưu tọa độ các ô học sinh đã tô: { [qNum]: [ { c, r, char, colX, rowY }, ... ] }

    for (let q = 0; q < 6; q++) {
      const qNum = q + 1;
      const qStartX = (171.5 + q * 240.0) * sx;
      let val = "";
      let isDoubleShaded = false;
      let violationCol = -1;

      for (let c = 0; c < 4; c++) {
        const colX = qStartX + c * colStepP3;
        const readings = [];
        // Cột 0: '-' (hàng 0) hoặc chữ số 0-9 (hàng 2-11)
        // Cột 1 & 2: ',' (hàng 1) hoặc chữ số 0-9 (hàng 2-11)
        // Cột 3: chỉ có chữ số 0-9 (hàng 2-11)
        const allowedRows = (c === 0) 
          ? [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
          : (c === 1 || c === 2)
            ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
            : [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

        for (const r of allowedRows) {
          const rowY = startYP3 + r * rowStepP3;
          readings.push({ char: charsP3[r], dark: getPeakDarkness(colX, rowY, 5, 3) });
        }
        readings.sort((a, b) => b.dark - a.dark);
        const minD = Math.min(...readings.map(o => o.dark));

        // Nhận diện các ô đạt độ đậm vượt ngưỡng
        const shadedInCol = readings.filter(o => (o.dark - minD) >= 28 && o.dark >= 95);
        if (shadedInCol.length >= 2) {
          // Bất kỳ cột nào có từ 2 ô tô trở lên -> Vi phạm quy chế tô đúp!
          isDoubleShaded = true;
          if (violationCol === -1) violationCol = c + 1;
        }

        // Lưu danh sách các ô học sinh đã tô (kể cả trường hợp tô đúp)
        shadedInCol.forEach(sItem => {
          const r = charsP3.indexOf(sItem.char);
          const rowY = startYP3 + r * rowStepP3;
          if (!p3Shaded[qNum]) p3Shaded[qNum] = [];
          p3Shaded[qNum].push({ c, r, char: sItem.char, colX, rowY });
        });

        if (shadedInCol.length === 1 && !isDoubleShaded) {
          val += shadedInCol[0].char;
        }
      }

      if (isDoubleShaded) {
        p3[qNum] = `ĐÚP_C${violationCol}`;
      } else {
        p3[qNum] = val;
      }
    }

    return {
      sbd,
      examCode: made,
      p1,
      p2,
      p3,
      p1Ambiguous,
      deltaYP3,
      p3Shaded
    };
  }

  /**
   * Vẽ khoanh tròn Xanh (câu đúng) và Đỏ gạch chéo (câu sai) trực quan lên ảnh
   */
  drawOverlayMarks(ctx, w, h, scanned, grading) {
    const scannedData = scanned || {};
    ctx.save();
    
    const sx = w / 1662.0;
    const sy = h / 2346.0;
    const sMin = Math.min(sx, sy);

    // 1. Huy hiệu chấm thi ở góc trên bên trái
    const badgeW = 420 * sx;
    const badgeH = 140 * sy;
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.fillRect(40 * sx, 30 * sy, badgeW, badgeH);
    ctx.strokeStyle = "#4f46e5";
    ctx.lineWidth = 3 * sMin;
    ctx.strokeRect(40 * sx, 30 * sy, badgeW, badgeH);

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(20 * sMin)}px sans-serif`;
    ctx.fillText(`SBD: ${scanned.sbd}  |  Mã đề: ${scanned.examCode}`, 60 * sx, 70 * sy);

    ctx.fillStyle = grading.totalScore >= 5.0 ? "#10b981" : "#ef4444";
    ctx.font = `bold ${Math.round(36 * sMin)}px sans-serif`;
    ctx.fillText(`${grading.totalScore.toFixed(2)}đ`, 60 * sx, 125 * sy);

    ctx.font = `bold ${Math.round(16 * sMin)}px sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`(P1:${grading.p1Score} | P2:${grading.p2Score} | P3:${grading.p3Score})`, 210 * sx, 122 * sy);

    // 2. PHẦN I: 40 câu trắc nghiệm (4 cột x 10 câu)
    const p1ColA = [176, 554, 932, 1310];
    const letters = ['A', 'B', 'C', 'D'];
    if (grading.details && grading.details.p1) {
      grading.details.p1.forEach(d => {
        const q = d.q;
        const b = Math.floor((q - 1) / 10);
        const rowIdx = (q - 1) % 10;
        const startX = p1ColA[b];
        const cy = (866 + rowIdx * 39.3) * sy;
        const chosen = d.actual;
        const exp = d.expected;

        letters.forEach((opt, oIdx) => {
          const cx = (startX + oIdx * 66.0) * sx;
          const r = 12 * sMin;

          if (opt === chosen) {
            if (d.isCorrect) {
              // KHOANH TRÒN XANH LÁ CHO CÂU ĐÚNG
              ctx.strokeStyle = "#16a34a";
              ctx.lineWidth = 3.5 * sMin;
              ctx.beginPath();
              ctx.arc(cx, cy, r + 4 * sMin, 0, Math.PI * 2);
              ctx.stroke();

              ctx.fillStyle = "#16a34a";
              ctx.font = `bold ${Math.round(14 * sMin)}px sans-serif`;
              ctx.fillText("✓", cx + r + 3 * sMin, cy - 2 * sMin);
            } else {
              // ĐỎ GẠCH CHÉO (X) CHO CÂU SAI
              ctx.strokeStyle = "#dc2626";
              ctx.lineWidth = 3.5 * sMin;
              const arm = r + 4 * sMin;
              ctx.beginPath();
              ctx.moveTo(cx - arm, cy - arm);
              ctx.lineTo(cx + arm, cy + arm);
              ctx.moveTo(cx + arm, cy - arm);
              ctx.lineTo(cx - arm, cy + arm);
              ctx.stroke();
            }
          } else if (!d.isCorrect && (opt === exp || exp === '*' || exp === 'ALL')) {
            // Nét đứt màu xanh lá chỉ ra đáp án đúng
            ctx.strokeStyle = "#16a34a";
            ctx.lineWidth = 2.5 * sMin;
            ctx.setLineDash([4 * sMin, 3 * sMin]);
            ctx.beginPath();
            ctx.arc(cx, cy, r + 4 * sMin, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        });
      });
    }

    // 3. PHẦN II: 8 câu Đúng/Sai (4 khối x 2 câu x 4 ý a, b, c, d)
    if (grading.details && grading.details.p2) {
      grading.details.p2.forEach(d => {
        const q = d.sheetQ;
        const b = Math.floor((q - 1) / 2);
        const isB = (q % 2 === 0);
        const startX = p1ColA[b] + (isB ? 136 : 4);

        if (d.subItems) {
          d.subItems.forEach((sub, sIdx) => {
            const cy = (1416 + sIdx * 40.0) * sy;
            const r = 11 * sMin;
            const chosen = sub.actual;
            const exp = sub.expected;

            ['Đ', 'S'].forEach((opt, oIdx) => {
              const cx = (startX + oIdx * 66.0) * sx;
              if (opt === chosen) {
                if (sub.isCorrect) {
                  // Khoanh tròn xanh lá
                  ctx.strokeStyle = "#16a34a";
                  ctx.lineWidth = 3.5 * sMin;
                  ctx.beginPath();
                  ctx.arc(cx, cy, r + 4 * sMin, 0, Math.PI * 2);
                  ctx.stroke();
                } else {
                  // Gạch chéo đỏ
                  ctx.strokeStyle = "#dc2626";
                  ctx.lineWidth = 3.5 * sMin;
                  const arm = r + 4 * sMin;
                  ctx.beginPath();
                  ctx.moveTo(cx - arm, cy - arm);
                  ctx.lineTo(cx + arm, cy + arm);
                  ctx.moveTo(cx + arm, cy - arm);
                  ctx.lineTo(cx - arm, cy + arm);
                  ctx.stroke();
                }
              }
            });
          });
        }
      });
    }

    // 4. PHẦN III: 6 câu trả lời ngắn
    if (grading.details && grading.details.p3) {
      const deltaYP3 = (scannedData && scannedData.deltaYP3 !== undefined) ? scannedData.deltaYP3 : 0;
      const rowStepP3 = 44.5 * sy;
      const colStepP3 = 40.0 * sx;
      const startYP3 = (1734.5 * sy) + deltaYP3;

      grading.details.p3.forEach(d => {
        const q = d.sheetQ;
        if (q < 1 || q > 6) return;
        const qStartX = (171.5 + (q - 1) * 240.0) * sx;
        const cx = qStartX + 35.0 * sx;
        const cy = 1680 * sy; // Khung điền số trên đầu bảng

        // Dấu ✓ hoặc ✗ trên đầu cột
        ctx.fillStyle = d.isCorrect ? "#16a34a" : "#dc2626";
        ctx.font = `bold ${Math.round(18 * sMin)}px sans-serif`;
        ctx.fillText(d.isCorrect ? "✓" : "✗", cx, cy);

        if (!d.isCorrect) {
          ctx.fillStyle = "#16a34a";
          ctx.font = `bold ${Math.round(13 * sMin)}px sans-serif`;
          ctx.fillText(`(${d.expected})`, cx + 22 * sx, cy);
        }

        // --- HIỆN MÀU Ô ĐÚNG / SAI TRÊN MA TRẬN PHẦN III GIỐNG PHẦN I & II ---
        const studentBubbles = (scannedData && scannedData.p3Shaded && scannedData.p3Shaded[q]) 
          ? scannedData.p3Shaded[q] 
          : [];

        // 1. Vẽ các ô học sinh đã tô
        studentBubbles.forEach(b => {
          const bX = b.colX || (qStartX + b.c * colStepP3);
          const bY = b.rowY || (startYP3 + b.r * rowStepP3);
          const r = 11 * sMin;

          if (d.isCorrect) {
            // Khoanh tròn màu xanh lá cho ô tô đúng
            ctx.strokeStyle = "#16a34a";
            ctx.lineWidth = 3.5 * sMin;
            ctx.beginPath();
            ctx.arc(bX, bY, r + 4 * sMin, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = "#16a34a";
            ctx.font = `bold ${Math.round(13 * sMin)}px sans-serif`;
            ctx.fillText("✓", bX + r + 2 * sMin, bY - 2 * sMin);
          } else {
            // Đỏ gạch chéo (X) cho ô tô sai hoặc vi phạm quy chế
            ctx.strokeStyle = "#dc2626";
            ctx.lineWidth = 3.5 * sMin;
            const arm = r + 4 * sMin;
            ctx.beginPath();
            ctx.moveTo(bX - arm, bY - arm);
            ctx.lineTo(bX + arm, bY + arm);
            ctx.moveTo(bX + arm, bY - arm);
            ctx.lineTo(bX - arm, bY + arm);
            ctx.stroke();
          }
        });

        // 2. Nếu câu sai: vẽ nét đứt màu xanh lá chỉ ra vị trí các ô đáp án đúng
        if (!d.isCorrect && d.expected && d.expected !== '*' && d.expected !== 'ALL') {
          // Lấy phương án chuẩn đầu tiên từ expected (ví dụ "1,5" hoặc "-0,5")
          const firstExp = d.expected.split(/[/;]/)[0].trim().replace(/\s+/g, '');
          for (let c = 0; c < Math.min(4, firstExp.length); c++) {
            const ch = firstExp[c];
            let rIdx = -1;
            if (ch === '-') rIdx = 0;
            else if (ch === ',' || ch === '.') rIdx = 1;
            else if (ch >= '0' && ch <= '9') rIdx = parseInt(ch, 10) + 2;

            if (rIdx >= 0) {
              const expX = qStartX + c * colStepP3;
              const expY = startYP3 + rIdx * rowStepP3;
              const r = 11 * sMin;

              ctx.strokeStyle = "#16a34a";
              ctx.lineWidth = 2.5 * sMin;
              ctx.setLineDash([4 * sMin, 3 * sMin]);
              ctx.beginPath();
              ctx.arc(expX, expY, r + 4 * sMin, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }
      });
    }

    ctx.restore();
  }
}

// Global instance
window.omrEngine = new OMREngine();
