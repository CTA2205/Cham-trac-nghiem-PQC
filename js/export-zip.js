/**
 * Export Zip Handler - Đóng gói kết quả & Hỗ trợ gửi Email / Google Drive
 * Hỗ trợ tự động phân loại theo cây thư mục và rã lớp (Multi-class split)
 * Sử dụng JSZip (jszip.min.js)
 */
class ExportZipHandler {
  constructor() {}

  /**
   * Sinh tên tệp ảnh bài làm chuẩn theo Số Báo Danh (SBD)
   * - Nếu có tên học sinh: SBD_TenHocSinh.jpg (VD: 12000001_Nguyen_Le_Dan_An.jpg)
   * - Nếu không có tên: SBD.jpg (VD: 12000001.jpg)
   * - Tự động tránh trùng tên bằng hậu tố (2), (3)...
   */
  getPaperImageFileName(item, idx = 0, usedNames = new Set()) {
    const rawSbd = (item && item.sbd ? item.sbd : '').toString().trim();
    const sbdPart = rawSbd && rawSbd !== '________' && !rawSbd.includes('X') 
      ? rawSbd 
      : `Chua_SBD_${idx + 1}`;
    
    const rawName = (item && item.name ? item.name : '').trim();
    const isGenericName = !rawName || /^học\s*sinh\s*sbd/i.test(rawName) || /^hoc\s*sinh\s*sbd/i.test(rawName);
    
    let baseName = sbdPart;
    if (!isGenericName) {
      // Chuẩn hóa tên bỏ dấu tiếng Việt để tương thích 100% mọi hệ điều hành khi giải nén ZIP
      const safeName = rawName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
      if (safeName) {
        baseName = `${sbdPart}_${safeName}`;
      }
    }

    let finalName = `${baseName}.jpg`;
    let counter = 1;
    while (usedNames.has(finalName)) {
      counter++;
      finalName = `${baseName}_(${counter}).jpg`;
    }
    usedNames.add(finalName);
    return finalName;
  }

  /**
   * Tạo gói nén ZIP gồm File Excel và Thư mục ảnh bài làm đã chấm
   * Tự động rã thư mục từng lớp nếu có nhiều lớp
   */
  async createResultsZip(gradedList, excelWorkbook, examMeta = {}) {
    if (!window.JSZip) {
      throw new Error("Thư viện JSZip chưa sẵn sàng!");
    }

    const zip = new JSZip();

    // Nhóm học sinh theo lớp
    const grouped = {};
    gradedList.forEach(item => {
      const cls = (item.className || examMeta.className || "Chua_Phan_Lop").trim().replace(/\s+/g, '_');
      if (!grouped[cls]) grouped[cls] = [];
      grouped[cls].push(item);
    });

    const classNames = Object.keys(grouped);
    const isMultiClass = classNames.length > 1;

    // 1. File Excel tổng (áp dụng Times New Roman và Borders)
    let excelBuffer = XLSX.write(excelWorkbook, { bookType: 'xlsx', type: 'array' });
    if (window.excelHandler && window.excelHandler.styleWorkbookWithTimesAndBorders) {
      excelBuffer = await window.excelHandler.styleWorkbookWithTimesAndBorders(excelBuffer, excelWorkbook);
    }
    const excelFileName = this.getExcelFileName(examMeta);

    // Luôn đặt tệp Excel bảng điểm tổng hợp tại thư mục gốc của file ZIP
    zip.file(excelFileName, excelBuffer);

    if (isMultiClass) {
      // Đóng gói rã theo từng lớp
      const summaryFolder = zip.folder("TongHop_ToanKhoi");
      summaryFolder.file(excelFileName, excelBuffer);

      for (const cls of classNames) {
        const classFolder = zip.folder(`Lop_${cls}`);
        const classItems = grouped[cls];

        // Tạo file excel riêng cho lớp này
        if (window.excelHandler) {
          const classWb = window.excelHandler.exportScoreWorkbook(classItems, { ...examMeta, className: cls });
          let classExcelBuf = XLSX.write(classWb, { bookType: 'xlsx', type: 'array' });
          if (window.excelHandler.styleWorkbookWithTimesAndBorders) {
            classExcelBuf = await window.excelHandler.styleWorkbookWithTimesAndBorders(classExcelBuf, classWb);
          }
          const classFileName = this.getExcelFileName(examMeta, cls);
          classFolder.file(classFileName, classExcelBuf);
        }

        // Thư mục ảnh bài làm của lớp này (tên file đặt chuẩn theo SBD)
        const imgFolder = classFolder.folder("BaiLam_HocSinh");
        const usedNames = new Set();
        classItems.forEach((item, idx) => {
          if (item.previewImage && item.previewImage.startsWith('data:image')) {
            const base64Data = item.previewImage.split(',')[1];
            const imgName = this.getPaperImageFileName(item, idx, usedNames);
            imgFolder.file(imgName, base64Data, { base64: true });
          }
        });
      }
    } else {
      // 1 lớp duy nhất: Tệp Excel ở gốc ZIP và Thư mục ảnh bài làm đặt tên theo SBD
      const imgFolder = zip.folder("BaiLam_HocSinh");
      const usedNames = new Set();
      gradedList.forEach((item, idx) => {
        if (item.previewImage && item.previewImage.startsWith('data:image')) {
          const base64Data = item.previewImage.split(',')[1];
          const imgName = this.getPaperImageFileName(item, idx, usedNames);
          imgFolder.file(imgName, base64Data, { base64: true });
        }
      });
    }

    // File tóm tắt báo cáo
    const summaryText = this.createSummaryReport(gradedList, examMeta, classNames);
    zip.file("Bao_Cao_Tong_Ket.txt", summaryText);

    // Xuất ra Blob
    const content = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    return {
      blob: content,
      fileName: this.getZipFileName(examMeta, isMultiClass),
      excelFileName
    };
  }

  getExcelFileName(meta, className = null) {
    if (window.excelHandler && window.excelHandler.getExportFileName) {
      return window.excelHandler.getExportFileName(meta, className);
    }
    const clean = (val, def) => (val || def || '').toString().trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
    const subject = clean(meta.subject, 'Môn');
    const grade = clean(meta.grade, 'Khối');
    const examName = clean(meta.examName, 'Kiểm tra');
    const curYear = new Date().getFullYear();
    const schoolYear = clean(meta.schoolYear, `${curYear - 1}-${curYear}`);

    if (className) {
      return `${subject}_${grade}_Lớp ${clean(className, 'Lớp')}_${examName}_${schoolYear}.xlsx`;
    }
    return `${subject}_${grade}_${examName}_${schoolYear}.xlsx`;
  }

  getZipFileName(meta, isMultiClass = false) {
    const clean = (val, def) => (val || def || '').toString().trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
    const subject = clean(meta.subject, 'Môn');
    const grade = clean(meta.grade, 'Khối');
    const examName = clean(meta.examName, 'Kiểm tra');
    const curYear = new Date().getFullYear();
    const schoolYear = clean(meta.schoolYear, `${curYear - 1}-${curYear}`);
    const cls = isMultiClass ? 'ToanKhoi' : `Lop_${clean(meta.className, 'Lop')}`;

    return `${subject}_${grade}_${cls}_${examName}_${schoolYear}_HO_SO_CHAM_THI.zip`;
  }

  createSummaryReport(gradedList, meta, classNames = []) {
    const total = gradedList.length;
    if (total === 0) return "Chưa có bài thi nào được chấm.";

    const scores = gradedList.map(s => s.totalScore);
    const avg = (scores.reduce((a, b) => a + b, 0) / total).toFixed(2);
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const countGioi = scores.filter(s => s >= 8.0).length;
    const countKha = scores.filter(s => s >= 6.5 && s < 8.0).length;
    const countTB = scores.filter(s => s >= 5.0 && s < 6.5).length;
    const countYeu = scores.filter(s => s < 5.0).length;

    let classSummary = "";
    if (classNames && classNames.length > 1) {
      classSummary = `\nDANH SÁCH CÁC LỚP TRONG ĐỢT CHẤM (${classNames.length} lớp):\n`;
      classNames.forEach(c => {
        const cItems = gradedList.filter(s => (s.className || meta.className || "Chua_Phan_Lop").trim().replace(/\s+/g, '_') === c);
        const cScores = cItems.map(s => s.totalScore);
        const cAvg = (cScores.reduce((a, b) => a + b, 0) / (cScores.length || 1)).toFixed(2);
        classSummary += ` - Lớp ${c}: ${cItems.length} bài | ĐTB: ${cAvg}đ\n`;
      });
    }

    return `=====================================================
BÁO CÁO TỔNG KẾT KẾT QUẢ CHẤM THI TRẮC NGHIỆM 2025
=====================================================
- Trường: ${meta.school || "N/A"}
- Môn thi: ${meta.subject || "N/A"} | Khối: ${meta.grade || "N/A"} | Lớp: ${meta.className || "N/A"}
- Kỳ thi: ${meta.examName || "N/A"}
- Ngày chấm: ${new Date().toLocaleString('vi-VN')}
-----------------------------------------------------
THỐNG KÊ CHUNG:
- Tổng số bài đã chấm: ${total} bài
- Điểm trung bình: ${avg} điểm
- Điểm cao nhất: ${max} điểm
- Điểm thấp nhất: ${min} điểm
${classSummary}
PHỔ ĐIỂM:
- Điểm Giỏi (8.0 - 10.0): ${countGioi} học sinh (${((countGioi / total) * 100).toFixed(1)}%)
- Điểm Khá (6.5 - 7.9):  ${countKha} học sinh (${((countKha / total) * 100).toFixed(1)}%)
- Điểm Trung bình (5.0 - 6.4): ${countTB} học sinh (${((countTB / total) * 100).toFixed(1)}%)
- Điểm Dưới TB (< 5.0):  ${countYeu} học sinh (${((countYeu / total) * 100).toFixed(1)}%)
=====================================================`;
  }

  downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

window.exportZipHandler = new ExportZipHandler();
