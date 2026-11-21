/**
 * Excel Handler - Xử lý tệp Đáp án, Danh sách học sinh & Xuất điểm
 * Sử dụng thư viện SheetJS (xlsx.full.min.js)
 */
class ExcelHandler {
  constructor() {
    this.rawWorkbook = null;
    this.currentSheetName = "";
  }

  /**
   * Đọc tệp MAU DAP AN.xlsx
   */
  async readAnswerKeyWorkbook(file) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    this.rawWorkbook = wb;

    const sheetNames = wb.SheetNames;
    const defaultSheet = sheetNames[0];
    this.currentSheetName = defaultSheet;

    const parsedKeys = this.parseAnswerKeySheet(wb, defaultSheet);
    return {
      sheetNames,
      activeSheet: defaultSheet,
      examKeys: parsedKeys
    };
  }

  /**
   * Chuyển sheet đáp án khác trong cùng workbook
   */
  switchAnswerSheet(sheetName) {
    if (!this.rawWorkbook || !this.rawWorkbook.Sheets[sheetName]) return null;
    this.currentSheetName = sheetName;
    return this.parseAnswerKeySheet(this.rawWorkbook, sheetName);
  }

  /**
   * Phân tích một sheet đáp án (tự động nhận 2, 4, 8... mã đề)
   */
  parseAnswerKeySheet(workbook, sheetName) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) return {};

    // Chuyển sang mảng 2 chiều
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (rows.length < 3) return {};

    const examKeys = {}; // { "1201": { p1: {}, p2: {}, p3: {} }, ... }
    const row1 = rows[0] || [];

    // Tìm tất cả các cột có chữ "Mã đề" ở hàng 1
    // Nhịp chuẩn: Cột Mã đề (C, H, M, R,...), kế bên là số mã đề
    for (let c = 0; c < row1.length; c++) {
      const val = String(row1[c]).trim().toLowerCase();
      const row2Val = (rows[1] && rows[1][c]) ? String(rows[1][c]).trim().toLowerCase() : "";
      if (val === "mã đề" || val === "ma de" || val.includes("mã") || val.includes("đề") || val.includes("made") || row2Val === "stt") {
        // Mã đề nằm ở ô tiếp theo (c+1 hoặc c+2 tùy format)
        let examCode = "";
        for (let k = c + 1; k <= c + 3 && k < row1.length; k++) {
          if (row1[k] !== undefined && String(row1[k]).trim() !== "") {
            examCode = String(row1[k]).trim();
            break;
          }
        }

        if (!examCode) continue;

        // Bắt đầu đọc đáp án cho mã đề này
        // Hàng 2: STT (c), Loại câu (c+1), Đáp án (c+2), Ghi chú (c+3)
        // Tìm đúng cột STT, Loại câu, Đáp án
        const sttCol = c;
        const typeCol = c + 1;
        const ansCol = c + 2;

        const p1 = {};
        const p2 = {};
        const p3 = {};

        for (let r = 2; r < rows.length; r++) {
          const rowData = rows[r];
          if (!rowData) continue;

          const stt = parseInt(rowData[sttCol], 10);
          const type = String(rowData[typeCol] || "").trim().toLowerCase();
          const ans = (rowData[ansCol] !== undefined && rowData[ansCol] !== null) ? String(rowData[ansCol]).trim() : "";

          if (isNaN(stt) || !ans) continue;

          if (type.includes("tn4") || type.includes("lựa chọn") || type.includes("lua chon")) {
            p1[stt] = ans.toUpperCase();
          } else if (type.includes("đúng sai") || type.includes("dung sai")) {
            p2[stt] = ans.toUpperCase();
          } else if (type.includes("trả lời ngắn") || type.includes("tra loi ngan") || type.includes("tln")) {
            p3[stt] = ans;
          } else {
            // Tự động nhận diện dựa trên nội dung đáp án
            if (/^[ABCDabcd]([,/][ABCDabcd])?$/.test(ans)) {
              p1[stt] = ans.toUpperCase();
            } else if (/[DSds]-[DSds]/.test(ans)) {
              p2[stt] = ans.toUpperCase();
            } else {
              p3[stt] = ans;
            }
          }
        }

        examKeys[examCode] = { p1, p2, p3 };
      }
    }

    return examKeys;
  }

  /**
   * Chuẩn hóa thông minh Số Báo Danh (8 chữ số theo chuẩn Bộ GD&ĐT):
   * Tự động sửa các lỗi phổ biến (01200004 -> 12000004, 1200004 -> 12000004, 1200030 -> 12000030, 4 -> 12000004)
   */
  normalizeSbd(rawInput, defaultGrade = '12') {
    if (!rawInput) return '';
    let s = String(rawInput).trim().replace(/[^0-9]/g, '');
    if (!s) return '';

    // Sửa lỗi tiền tố '0' đứng trước khối do padStart cũ: 01200004 -> 12000004
    if (s.length === 8 && (s.startsWith('010') || s.startsWith('011') || s.startsWith('012'))) {
      const grade = s.substring(1, 3);
      const num = s.substring(3).replace(/^0+/, '') || '0';
      return grade + num.padStart(6, '0');
    }

    if (s.length === 8) return s;

    const g = defaultGrade ? String(defaultGrade).padStart(2, '0').slice(-2) : '12';
    const prefixMatch = s.match(/^(10|11|12)(.*)$/);
    if (prefixMatch && s.length < 8) {
      const prefix = prefixMatch[1];
      const rest = prefixMatch[2];
      const numPart = rest.replace(/^0+/, '') || '0';
      return prefix + numPart.padStart(6, '0');
    }

    if (s.length <= 4) {
      const numPart = s.replace(/^0+/, '') || s;
      return g + numPart.padStart(6, '0');
    }

    if (s.length < 8) {
      return s.padStart(8, '0');
    }

    return s.slice(0, 8);
  }

  /**
   * Đọc tệp DANH SACH HỌC SINH.xlsx (Chấp nhận cả File và ArrayBuffer)
   */
  async readStudentListWorkbook(file) {
    const data = (file instanceof ArrayBuffer) ? file : (file.arrayBuffer ? await file.arrayBuffer() : file);
    const wb = XLSX.read(data, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const students = [];
    // Tìm hàng tiêu đề (thường là hàng 1 hoặc hàng 2)
    let headerRowIdx = -1;
    let sbdCol = 1, nameCol = 2, classCol = 3;

    for (let r = 0; r < Math.min(rows.length, 5); r++) {
      const row = rows[r].map(cell => String(cell).toLowerCase().trim());
      const sbdIdx = row.findIndex(c => c.includes("báo danh") || c.includes("sbd") || c.includes("bao danh"));
      if (sbdIdx !== -1) {
        headerRowIdx = r;
        sbdCol = sbdIdx;
        const nIdx = row.findIndex(c => c.includes("họ") || c.includes("tên") || c.includes("ten"));
        if (nIdx !== -1) nameCol = nIdx;
        const cIdx = row.findIndex(c => c.includes("lớp") || c.includes("lop"));
        if (cIdx !== -1) classCol = cIdx;
        break;
      }
    }

    const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 1;
    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[sbdCol]) continue;
      let sbd = String(row[sbdCol]).trim();
      const name = String(row[nameCol] || "").trim();
      const className = String(row[classCol] || "").trim();

      if (sbd && !isNaN(parseInt(sbd, 10))) {
        if (sbd.length < 8) sbd = this.normalizeSbd(sbd, '12');
        students.push({ sbd, name, className });
      }
    }

    return students;
  }

  /**
   * Tạo tên file xuất Excel chuẩn theo quy định:
   * Môn học_Khối_Tên kỳ kiểm tra_Năm học.xlsx
   */
  getExportFileName(examMeta = {}, className = null) {
    const clean = (val, def) => (val || def || '').toString().trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ');

    const subject = clean(examMeta.subject, 'Môn');
    const grade = clean(examMeta.grade, 'Khối');
    const examName = clean(examMeta.examName, 'Kiểm tra');
    const curYear = new Date().getFullYear();
    const schoolYear = clean(examMeta.schoolYear, `${curYear - 1}-${curYear}`);

    if (className) {
      const cls = clean(className, 'Lớp');
      return `${subject}_${grade}_Lớp ${cls}_${examName}_${schoolYear}.xlsx`;
    }
    return `${subject}_${grade}_${examName}_${schoolYear}.xlsx`;
  }

  /**
   * Xuất file Excel bảng điểm chuẩn 10 cột, có tiêu đề hành chính,
   * dòng ngày xuất An Giang và 3 chức danh ký duyệt cuối bảng.
   * Tự động tách sheet theo từng lớp nếu có nhiều lớp.
   */
  exportScoreWorkbook(gradedList, examMeta = {}) {
    const wb = XLSX.utils.book_new();

    // Nhóm học sinh theo lớp
    const grouped = {};
    gradedList.forEach(item => {
      // Ưu tiên examMeta.className nếu bài thi chưa có lớp hoặc là "Tự do" / "Chưa phân lớp"
      let cls = (item.className || '').trim();
      if (!cls || cls === 'Tự do' || cls === 'Chưa rõ' || cls === 'Chưa phân lớp') {
        cls = (examMeta.className || 'Chưa phân lớp').trim();
      }
      if (!grouped[cls]) grouped[cls] = [];
      grouped[cls].push(item);
    });

    const classNames = Object.keys(grouped);
    const isMultiClass = classNames.length > 1;

    // Helper tạo worksheet từ mảng học sinh kèm phần đầu và chân chuẩn thể thức
    const buildSheet = (items, className = null) => {
      const now = new Date();
      const d = String(now.getDate()).padStart(2, '0');
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const y = now.getFullYear();
      const dateText = `An Giang, ngày ${d} tháng ${m} năm ${y}`;

      const schoolName = (examMeta.school || "TRƯỜNG THPT .........................").toUpperCase();
      const examTitle = (examMeta.examName || "KIỂM TRA").toUpperCase();
      const schoolYear = examMeta.schoolYear || `${y - 1}-${y}`;
      const subject = examMeta.subject || "";
      const grade = examMeta.grade ? `Khối ${examMeta.grade}` : "";
      const clsDisplay = className ? `Lớp: ${className}` : (examMeta.className ? `Lớp: ${examMeta.className}` : "Toàn khối");
      const examDate = examMeta.examDate || "";

      const headers = [
        "STT",
        "Số báo danh",
        "Họ và tên học sinh",
        "Lớp",
        "Mã đề",
        "Điểm TN4LC",
        "Điểm đúng - sai",
        "Điểm TLN",
        "Tổng điểm",
        "Lưu ý"
      ];

      const data = [
        [schoolName, "", "", "", "", "", "", "", "", ""],                                          // Dòng 1 (idx 0)
        ["BẢNG TỔNG HỢP KẾT QUẢ ĐIỂM THI TRẮC NGHIỆM", "", "", "", "", "", "", "", "", ""],         // Dòng 2 (idx 1)
        [`KỲ KIỂM TRA: ${examTitle} - NĂM HỌC: ${schoolYear}`, "", "", "", "", "", "", "", "", ""],  // Dòng 3 (idx 2)
        [`Môn: ${subject} | ${grade} | ${clsDisplay} | Ngày thi: ${examDate}`, "", "", "", "", "", "", "", "", ""], // Dòng 4 (idx 3)
        ["", "", "", "", "", "", "", "", "", ""],                                                   // Dòng 5 (idx 4)
        headers                                                                                     // Dòng 6 (idx 5)
      ];

      const toScoreVal = (val) => {
        if (val === undefined || val === null || val === "" || isNaN(Number(val))) return "";
        return Number(Number(val).toFixed(2));
      };

      // Sắp xếp bài thi theo Số báo danh (cột B) từ nhỏ đến lớn (Chuẩn hóa chuẩn 8 số Bộ GD&ĐT)
      const defaultG = examMeta.grade || '12';
      const sortedItems = [...items].sort((a, b) => {
        const sbdA = this.normalizeSbd(a.sbd, defaultG) || String(a.sbd || '').trim();
        const sbdB = this.normalizeSbd(b.sbd, defaultG) || String(b.sbd || '').trim();

        const numA = parseInt(sbdA.replace(/\D/g, ''), 10);
        const numB = parseInt(sbdB.replace(/\D/g, ''), 10);

        const hasNumA = !isNaN(numA) && sbdA !== '' && !sbdA.includes('_');
        const hasNumB = !isNaN(numB) && sbdB !== '' && !sbdB.includes('_');

        // Đưa các bài có SBD số hợp lệ lên trước sắp xếp từ nhỏ đến lớn
        if (hasNumA && !hasNumB) return -1;
        if (!hasNumA && hasNumB) return 1;

        if (hasNumA && hasNumB) {
          if (numA !== numB) return numA - numB;
          return sbdA.localeCompare(sbdB, undefined, { numeric: true });
        }

        return sbdA.localeCompare(sbdB, undefined, { numeric: true });
      });

      sortedItems.forEach((item, idx) => {
        const finalSbd = this.normalizeSbd(item.sbd, defaultG) || item.sbd || "";
        data.push([
          idx + 1,
          finalSbd,
          item.name || "",
          item.className || examMeta.className || "",
          item.examCode || "",
          toScoreVal(item.p1Score),
          toScoreVal(item.p2Score),
          toScoreVal(item.p3Score),
          toScoreVal(item.totalScore),
          item.notes || ""
        ]);
      });

      const totalStudents = items.length;
      let avgScore = "0.00";
      let maxScore = "0.00";
      let minScore = "0.00";
      if (totalStudents > 0) {
        const scores = items.map(c => Number(c.totalScore) || 0);
        const sum = scores.reduce((a, b) => a + b, 0);
        avgScore = (sum / totalStudents).toFixed(2);
        maxScore = Math.max(...scores).toFixed(2);
        minScore = Math.min(...scores).toFixed(2);
      }

      // Dòng thống kê cuối bảng dữ liệu
      data.push([
        "",
        "",
        `TỔNG CỘNG: ${totalStudents} BÀI THI`,
        "",
        "",
        "",
        `Điểm TB: ${avgScore}`,
        `Cao nhất: ${maxScore} | Thấp nhất: ${minScore}`,
        "",
        ""
      ]);

      // Dòng trống
      data.push(["", "", "", "", "", "", "", "", "", ""]);

      // Dòng ngày xuất An Giang (canh phải)
      data.push(["", "", "", "", "", "", "", dateText, "", ""]);

      // Dòng trống
      data.push(["", "", "", "", "", "", "", "", "", ""]);

      // 3 Cột chức danh
      data.push(["CHỦ TỊCH HỘI ĐỒNG", "", "", "TỔ KIỂM TRA", "", "", "", "TỔ CHẤM", "", ""]);

      // Chú thích ký tên
      data.push(["(Ký, ghi rõ họ tên)", "", "", "(Ký, ghi rõ họ tên)", "", "", "", "(Ký, ghi rõ họ tên)", "", ""]);

      // Chừa 4 dòng trống để ký và ghi họ tên
      for (let k = 0; k < 4; k++) {
        data.push(["", "", "", "", "", "", "", "", "", ""]);
      }

      const ws = XLSX.utils.aoa_to_sheet(data);

      // Định dạng số thập phân 2 chữ số cho các cột điểm (F: TN4LC, G: Đúng-Sai, H: TLN, I: Tổng điểm)
      for (let r = 7; r <= 6 + totalStudents; r++) {
        ['F', 'G', 'H', 'I'].forEach(col => {
          const cell = ws[`${col}${r}`];
          if (cell && cell.t === 'n') {
            cell.z = '0.00';
            XLSX.utils.format_cell(cell);
          }
        });
      }

      ws['!cols'] = [
        { wch: 6 },  // STT
        { wch: 13 }, // SBD (8 số)
        { wch: 24 }, // Họ và tên học sinh
        { wch: 9 },  // Lớp
        { wch: 9 },  // Mã đề
        { wch: 12 }, // Điểm TN4LC
        { wch: 14 }, // Điểm đúng - sai
        { wch: 11 }, // Điểm TLN
        { wch: 12 }, // Tổng điểm
        { wch: 28 }  // Lưu ý (rộng và dãn dòng wrapText tự động chống tràn ô)
      ];

      const summaryRowIdx = 6 + totalStudents;
      const dateRowIdx = summaryRowIdx + 2;
      const signRowIdx = summaryRowIdx + 4;
      const signHintRowIdx = summaryRowIdx + 5;

      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, // Tên trường A1:E1
        { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }, // Tiêu đề A2:J2
        { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } }, // Kỳ kiểm tra A3:J3
        { s: { r: 3, c: 0 }, e: { r: 3, c: 9 } }, // Môn, khối, lớp A4:J4
        { s: { r: summaryRowIdx, c: 2 }, e: { r: summaryRowIdx, c: 5 } }, // TỔNG CỘNG C:F
        { s: { r: summaryRowIdx, c: 7 }, e: { r: summaryRowIdx, c: 9 } }, // Thống kê H:J
        { s: { r: dateRowIdx, c: 6 }, e: { r: dateRowIdx, c: 9 } },        // An Giang, ngày ... G:J
        { s: { r: signRowIdx, c: 0 }, e: { r: signRowIdx, c: 2 } },        // CHỦ TỊCH HỘI ĐỒNG A:C
        { s: { r: signRowIdx, c: 3 }, e: { r: signRowIdx, c: 5 } },        // TỔ KIỂM TRA D:F
        { s: { r: signRowIdx, c: 7 }, e: { r: signRowIdx, c: 9 } },        // TỔ CHẤM H:J
        { s: { r: signHintRowIdx, c: 0 }, e: { r: signHintRowIdx, c: 2 } }, // (Ký tên) A:C
        { s: { r: signHintRowIdx, c: 3 }, e: { r: signHintRowIdx, c: 5 } }, // (Ký tên) D:F
        { s: { r: signHintRowIdx, c: 7 }, e: { r: signHintRowIdx, c: 9 } }, // (Ký tên) H:J
      ];

      ws._layoutMeta = {
        headerRow: 6,
        dataStartRow: 7,
        dataEndRow: 6 + totalStudents,
        summaryRow: summaryRowIdx + 1,
        dateRow: dateRowIdx + 1,
        signRow: signRowIdx + 1,
        signHintRow: signHintRowIdx + 1
      };

      return ws;
    };

    if (isMultiClass) {
      // 1. Sheet Tổng hợp toàn khối
      const wsTongHop = buildSheet(gradedList);
      XLSX.utils.book_append_sheet(wb, wsTongHop, "TONG_HOP");

      // 2. Sheet riêng cho từng lớp
      classNames.forEach(cls => {
        const cleanSheetName = `Lop_${cls}`.slice(0, 31);
        const wsClass = buildSheet(grouped[cls], cls);
        XLSX.utils.book_append_sheet(wb, wsClass, cleanSheetName);
      });
    } else {
      // Chỉ 1 lớp duy nhất
      const singleSheetName = classNames.length > 0 
        ? `Lop_${classNames[0]}`.slice(0, 31)
        : ((examMeta.subject && examMeta.grade) ? `${examMeta.subject.toUpperCase()}_K${examMeta.grade}` : "MON_KHOI");
      const wsSingle = buildSheet(gradedList, classNames[0] || null);
      XLSX.utils.book_append_sheet(wb, wsSingle, singleSheetName);
    }

    // Cấu hình lặp lại dòng tiêu đề cột ($6:$6) khi in hoặc xem trang 2, 3...
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Names = wb.Workbook.Names || [];
    wb.SheetNames.forEach((sheetName, sIdx) => {
      wb.Workbook.Names.push({
        Name: '_xlnm.Print_Titles',
        Sheet: sIdx,
        Ref: `'${sheetName.replace(/'/g, "''")}'!$6:$6`
      });
    });

    return wb;
  }

  /**
   * Định dạng tệp Excel: Áp dụng toàn bộ phông chữ Times New Roman,
   * kẻ khung viền (thin border) cho toàn bộ bảng dữ liệu điểm,
   * căn lề chuẩn và in hoa đậm tiêu đề.
   */
  async styleWorkbookWithTimesAndBorders(rawArrayBuffer, workbook = null) {
    const ZipConstructor = (typeof window !== 'undefined' && window.JSZip) ? window.JSZip : (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!ZipConstructor) {
      return rawArrayBuffer;
    }

    try {
      const zip = new ZipConstructor();
      await zip.loadAsync(rawArrayBuffer);

      // Cấu hình StyleSheet với Times New Roman và Thin Border
      const customStylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="12"/><color rgb="FF000000"/><name val="Times New Roman"/></font>
    <font><b/><sz val="12"/><color rgb="FF000000"/><name val="Times New Roman"/></font>
    <font><b/><sz val="14"/><color rgb="FF000000"/><name val="Times New Roman"/></font>
    <font><i/><sz val="11"/><color rgb="FF000000"/><name val="Times New Roman"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="15">
    <!-- 0: Default Normal Times New Roman 12 -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <!-- 1: Title 14 bold center -->
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 2: Subtitle 12 bold center -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 3: Info 12 italic center -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 4: Table Header center bold with border -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <!-- 5: Table Data center with border -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 6: Table Data left with border (Họ tên) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 7: Summary Row bold center with border -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 8: Date right italic no border -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 9: Sign title bold center no border -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 10: Sign hint 11 italic center no border -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 11: School name 12 bold left no border -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 12: Table Score center with border, 2 decimals (numFmtId="2") -->
    <xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 13: Total Score BOLD center with border, 2 decimals (numFmtId="2") -->
    <xf numFmtId="2" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 14: Note cell left with border AND wrapText (Cột J: Lưu ý dãn dòng tự động chống tràn ô) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

      zip.file('xl/styles.xml', customStylesXml);

      // Cập nhật gán style cho từng ô trong từng sheet
      const sheetFiles = Object.keys(zip.files).filter(f => f.startsWith('xl/worksheets/sheet') && f.endsWith('.xml'));

      for (let sIdx = 0; sIdx < sheetFiles.length; sIdx++) {
        const sheetPath = sheetFiles[sIdx];
        let sheetXml = await zip.file(sheetPath).async('text');

        let meta = null;
        if (workbook && workbook.SheetNames && workbook.SheetNames[sIdx]) {
          const ws = workbook.Sheets[workbook.SheetNames[sIdx]];
          meta = ws ? ws._layoutMeta : null;
        }

        const headerRow = meta ? meta.headerRow : 6;
        const dataEndRow = meta ? meta.dataEndRow : 1000;
        const summaryRow = meta ? meta.summaryRow : dataEndRow + 1;
        const dateRow = meta ? meta.dateRow : summaryRow + 2;
        const signRow = meta ? meta.signRow : dateRow + 2;
        const signHintRow = meta ? meta.signHintRow : signRow + 1;

        sheetXml = sheetXml.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>/g, (match, col, rowStr, rest) => {
          const rowNum = parseInt(rowStr, 10);
          let styleId = 0;

          if (rowNum === 1) {
            styleId = 11; // Tên trường (đậm, trái)
          } else if (rowNum === 2) {
            styleId = 1;  // Tiêu đề 14 đậm giữa
          } else if (rowNum === 3) {
            styleId = 2;  // Kỳ kiểm tra 12 đậm giữa
          } else if (rowNum === 4) {
            styleId = 3;  // Môn, khối, ngày thi 12 nghiêng giữa
          } else if (rowNum === headerRow) {
            styleId = 4;  // Tiêu đề cột 12 đậm giữa, kẻ khung
          } else if (rowNum > headerRow && rowNum <= dataEndRow) {
            if (col === 'I') {
              styleId = 13; // Tổng điểm: in đậm giữa, 2 chữ số thập phân, kẻ khung
            } else if (col === 'F' || col === 'G' || col === 'H') {
              styleId = 12; // Điểm thành phần: giữa, 2 chữ số thập phân, kẻ khung
            } else if (col === 'J') {
              styleId = 14; // Cột J (Lưu ý): căn trái, dãn dòng tự động wrapText="1", kẻ khung
            } else if (col === 'C') {
              styleId = 6;  // Cột C (Họ tên): căn trái, kẻ khung
            } else {
              styleId = 5;  // STT, SBD, Lớp, Mã đề: giữa, kẻ khung
            }
          } else if (rowNum === summaryRow) {
            styleId = 7;  // Dòng thống kê đậm giữa, kẻ khung
          } else if (rowNum === dateRow) {
            styleId = 8;  // Ngày xuất An Giang nghiêng phải
          } else if (rowNum === signRow) {
            styleId = 9;  // 3 Chức danh đậm giữa
          } else if (rowNum === signHintRow) {
            styleId = 10; // (Ký, ghi rõ họ tên) nghiêng giữa
          }

          const cleanRest = rest.replace(/\s*s="\d+"/g, '');
          return `<c r="${col}${rowStr}" s="${styleId}"${cleanRest}>`;
        });

        // 1. Thêm cấu hình sheetPr để fit vừa trang in (fitToPage="1")
        if (!sheetXml.includes('<sheetPr>')) {
          sheetXml = sheetXml.replace('<dimension', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
        } else if (!sheetXml.includes('fitToPage')) {
          sheetXml = sheetXml.replace('<sheetPr>', '<sheetPr><pageSetUpPr fitToPage="1"/>');
        }

        // 2. Thêm cấu hình in ấn: Khổ A4 ngang (paperSize="9", orientation="landscape"),
        // căn giữa trang in và tự động co vừa 1 trang ngang (fitToWidth="1")
        const pageSetupXml = '<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';

        if (sheetXml.includes('<ignoredErrors')) {
          sheetXml = sheetXml.replace('<ignoredErrors', pageSetupXml + '<ignoredErrors');
        } else {
          sheetXml = sheetXml.replace('</worksheet>', pageSetupXml + '</worksheet>');
        }

        zip.file(sheetPath, sheetXml);
      }

      // 3. Đảm bảo cấu hình lặp lại dòng tiêu đề (Print_Titles $6:$6) trong xl/workbook.xml khi in sang trang
      if (zip.file('xl/workbook.xml')) {
        let wbXml = await zip.file('xl/workbook.xml').async('text');
        if (!wbXml.includes('_xlnm.Print_Titles')) {
          const sheetNames = (workbook && workbook.SheetNames && workbook.SheetNames.length > 0)
            ? workbook.SheetNames
            : ['Sheet1'];
          let defNamesXml = '<definedNames>';
          sheetNames.forEach((sName, idx) => {
            const cleanName = sName.replace(/'/g, '&apos;');
            defNamesXml += `<definedName name="_xlnm.Print_Titles" localSheetId="${idx}">&apos;${cleanName}&apos;!$6:$6</definedName>`;
          });
          defNamesXml += '</definedNames>';

          if (wbXml.includes('</sheets>')) {
            wbXml = wbXml.replace('</sheets>', '</sheets>' + defNamesXml);
          } else {
            wbXml = wbXml.replace('</workbook>', defNamesXml + '</workbook>');
          }
          zip.file('xl/workbook.xml', wbXml);
        }
      }

      const isBrowser = (typeof window !== 'undefined' && typeof window.document !== 'undefined');
      const outType = isBrowser ? 'blob' : 'nodebuffer';
      return await zip.generateAsync({
        type: outType,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        compression: 'DEFLATE'
      });
    } catch (err) {
      console.warn("Lỗi khi áp dụng style Excel nâng cao:", err);
      return rawArrayBuffer;
    }
  }

  /**
   * Tải xuống trực tiếp file Excel bảng điểm đã được định dạng
   */
  async exportScoreExcelFile(gradedList, examMeta = {}) {
    const wb = this.exportScoreWorkbook(gradedList, examMeta);
    const rawBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const styledData = await this.styleWorkbookWithTimesAndBorders(rawBuffer, wb);
    const fileName = this.getExportFileName(examMeta);

    if (typeof window !== 'undefined') {
      const blob = (styledData instanceof Blob)
        ? styledData
        : new Blob([styledData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }
    return fileName;
  }

  /**
   * Tạo tệp MAU DAP AN.xlsx từ trình tạo trên web
   */
  generateAnswerKeyWorkbook(examKeysConfig) {
    const wb = XLSX.utils.book_new();
    const wsData = [];

    // examKeysConfig: [ { code: "1201", p1: [...], p2: [...], p3: [...] }, ... ]
    const numCodes = examKeysConfig.length;

    // Hàng 1: Mã đề
    const row1 = [];
    // Hàng 2: Header
    const row2 = [];

    examKeysConfig.forEach((cfg, idx) => {
      row1.push("Mã đề", "", cfg.code, "");
      row2.push("STT", "Loại câu", "Đáp án", "Ghi chú");
      if (idx < numCodes - 1) {
        row1.push(""); // Cột ngăn cách
        row2.push("");
      }
    });

    wsData.push(row1);
    wsData.push(row2);

    // Tìm số câu lớn nhất
    let maxRows = 0;
    examKeysConfig.forEach(cfg => {
      const count = cfg.items.length;
      if (count > maxRows) maxRows = count;
    });

    for (let r = 0; r < maxRows; r++) {
      const row = [];
      examKeysConfig.forEach((cfg, idx) => {
        const item = cfg.items[r];
        if (item) {
          row.push(item.stt, item.type, item.ans, item.note || "");
        } else {
          row.push("", "", "", "");
        }
        if (idx < numCodes - 1) {
          row.push(""); // Cột trống
        }
      });
      wsData.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Mau dap an");
    return wb;
  }
}

window.excelHandler = new ExcelHandler();
