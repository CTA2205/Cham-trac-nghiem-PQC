/**
 * StorageDB - Quản lý cơ sở dữ liệu ngầm IndexedDB của trình duyệt
 * Cho phép lưu trữ không giới hạn dung lượng: Toàn bộ bài đã chấm, ảnh bài thi, đáp án, danh sách HS
 * Đảm bảo tắt app mở lại 100% dữ liệu vẫn còn nguyên vẹn cho đến khi người dùng yêu cầu xóa.
 */
const DB_NAME = 'OMR_GRADING_DB_2025';
const DB_VERSION = 1;
const STORE_NAME = 'exam_store';

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("IndexedDB get error:", e);
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("IndexedDB set error:", e);
    return false;
  }
}

/**
 * Main Application Controller
 */
class AppController {
  constructor() {
    this.state = {
      examMeta: {
        school: "TRƯỜNG PT THỰC HÀNH SƯ PHẠM",
        grade: "12",
        className: "12A",
        subject: "Toán",
        examName: "Kiểm tra Giữa kỳ I",
        schoolYear: "2024-2025",
        examDate: new Date().toISOString().slice(0, 10)
      },
      gradingRules: {
        p1: { type: 'per_question', pointPerQuestion: 0.25, totalPoints: 4.0 },
        p2: { mode: 'standard', maxPointPerQuestion: 1.0, pointPerItem: 0.25 },
        p3: { pointPerQuestion: 0.5 }
      },
      answerKeyWorkbook: null,
      availableSheets: [],
      currentSheet: "Mau 12",
      activeExamKeys: {},
      selectedExamCode: "1201",
      studentList: [],
      gradedList: [],
      lookupMode: 'sbd', // 'sbd' | 'name' | 'all'
      lookupQuery: '',
      lookupSelectedId: '',
      scanCardLookupMode: 'all', // 'sbd' | 'name' | 'all'
      scanCardLookupQuery: '',
      scanCardLookupSelectedId: '',
      cameraStream: null,
      isAutoScanning: false,
      currentReviewItem: null,
      currentReviewIndex: 0,
      currentReviewZoom: 1.0
    };
  }

  async init() {
    await this.loadPersistedState();
    this.bindEvents();
    this.renderMetaInputs();
    this.renderGradingInputs();
    this.updateStatsBar();
    this.updateClassBreakdown();
    this.renderScanLookupControls();
    this.renderRecentScanTable();

    // Nạp sẵn dữ liệu mặc định chỉ khi chưa có dữ liệu nào trong máy
    await this.tryLoadInitialFiles();
  }

  async loadPersistedState() {
    try {
      const session = await idbGet('active_session');
      if (session) {
        if (session.examMeta) {
          this.state.examMeta = session.examMeta;
          if (!this.state.examMeta.school || this.state.examMeta.school.includes("Nguyễn Huệ") || this.state.examMeta.school === "THPT Nguyễn Huệ") {
            this.state.examMeta.school = "TRƯỜNG PT THỰC HÀNH SƯ PHẠM";
          }
        }
        if (session.gradingRules) this.state.gradingRules = session.gradingRules;
        if (session.answerSource) this.state.answerSource = session.answerSource;
        if (session.excelExamKeys) this.state.excelExamKeys = session.excelExamKeys;
        if (session.directExamKeys) this.state.directExamKeys = session.directExamKeys;
        if (session.currentSheet) this.state.currentSheet = session.currentSheet;
        if (session.availableSheets) this.state.availableSheets = session.availableSheets;
        if (session.activeExamKeys && Object.keys(session.activeExamKeys).length > 0) {
          this.state.activeExamKeys = session.activeExamKeys;
        }
        if (session.studentList && session.studentList.length > 0) {
          this.state.studentList = session.studentList;
        } else {
          this.state.studentList = [];
        }
        if (session.gradedList && session.gradedList.length > 0) {
          // Bảo toàn 100% dữ liệu bài thi của học sinh, chỉ lọc bài tạo giả lập (sim_) nếu có
          this.state.gradedList = session.gradedList.filter(item =>
            !(item.id && String(item.id).startsWith('sim_'))
          );
        } else {
          this.state.gradedList = [];
        }
        console.log(`Đã khôi phục phiên làm việc: ${this.state.gradedList.length} bài đã chấm`);
      } else {
        const savedMeta = localStorage.getItem('omr_exam_meta');
        if (savedMeta) {
          this.state.examMeta = JSON.parse(savedMeta);
          if (!this.state.examMeta.school || this.state.examMeta.school.includes("Nguyễn Huệ") || this.state.examMeta.school === "THPT Nguyễn Huệ") {
            this.state.examMeta.school = "TRƯỜNG PT THỰC HÀNH SƯ PHẠM";
          }
        }
        const savedRules = localStorage.getItem('omr_grading_rules');
        if (savedRules) this.state.gradingRules = JSON.parse(savedRules);
      }
    } catch (e) {
      console.warn("Lỗi đọc IndexedDB:", e);
    }
  }

  async saveState() {
    try {
      localStorage.setItem('omr_exam_meta', JSON.stringify(this.state.examMeta));
      localStorage.setItem('omr_grading_rules', JSON.stringify(this.state.gradingRules));
      await idbSet('active_session', {
        examMeta: this.state.examMeta,
        gradingRules: this.state.gradingRules,
        answerSource: this.state.answerSource || 'excel',
        activeExamKeys: this.state.activeExamKeys,
        excelExamKeys: this.state.excelExamKeys,
        directExamKeys: this.state.directExamKeys,
        currentSheet: this.state.currentSheet,
        availableSheets: this.state.availableSheets,
        studentList: this.state.studentList,
        gradedList: this.state.gradedList,
        savedAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn("Lỗi lưu IndexedDB:", e);
    }
  }

  showToast(message, type = "info") {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'danger' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  bindEvents() {
    // Chuyển tab
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    // Tải file MAU DAP AN
    const ansInput = document.getElementById('answerFileInput');
    if (ansInput) {
      ansInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
          await this.handleAnswerFileUpload(e.target.files[0]);
        }
      });
    }

    // Nút Hủy chọn tệp đáp án
    const clearAnsFileBtn = document.getElementById('btnClearAnswerFile');
    if (clearAnsFileBtn) {
      clearAnsFileBtn.addEventListener('click', () => this.clearAnswerFile());
    }

    // Chọn nguồn đáp án: Tệp Excel (Mục 2) hoặc Nhập trực tiếp (Mục 3)
    document.querySelectorAll('input[name="ansSourceRadio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.setAnswerSource(e.target.value);
      });
    });

    // Đổi sheet đáp án
    const sheetSelect = document.getElementById('sheetSelect');
    if (sheetSelect) {
      sheetSelect.addEventListener('change', (e) => {
        const newSheet = e.target.value;
        this.switchAnswerSheet(newSheet);
      });
    }

    // Tải file DANH SACH HOC SINH
    const stuInput = document.getElementById('studentFileInput');
    if (stuInput) {
      stuInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
          await this.handleStudentFileUpload(e.target.files[0]);
        }
      });
    }

    // Nút Hủy chọn danh sách học sinh
    const clearStuFileBtn = document.getElementById('btnClearStudentFile');
    if (clearStuFileBtn) {
      clearStuFileBtn.addEventListener('click', () => this.clearStudentFile());
    }

    // Tải file mẫu danh sách học sinh
    const dlSampleBtn = document.getElementById('btnDownloadSampleStudents');
    if (dlSampleBtn) {
      dlSampleBtn.addEventListener('click', () => {
        this.downloadSampleStudentExcel();
      });
    }

    // Tải ảnh bài thi chấm hàng loạt (Batch upload nhiều file ảnh)
    const batchInput = document.getElementById('batchImagesInput');
    if (batchInput) {
      batchInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
          this.handleStagedFiles(e.target.files);
        }
      });
    }

    // Tải nguyên thư mục ảnh bài thi (Folder upload)
    const folderInput = document.getElementById('folderImagesInput');
    if (folderInput) {
      folderInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
          this.handleStagedFiles(e.target.files);
        }
      });
    }

    // Bật/tắt camera
    const toggleCamBtn = document.getElementById('btnToggleCamera');
    if (toggleCamBtn) {
      toggleCamBtn.addEventListener('click', () => this.toggleCamera());
    }

    // Nút chụp bài thủ công từ camera
    const captureBtn = document.getElementById('btnManualCapture');
    if (captureBtn) {
      captureBtn.addEventListener('click', () => this.captureCurrentFrame());
    }

    // Chụp trực tiếp bằng Camera điện thoại (Mobile Native Camera capture)
    const mobileCamInput = document.getElementById('mobileCameraInput');
    const btnMobileCam = document.getElementById('btnMobileCameraTrigger');
    if (btnMobileCam && mobileCamInput) {
      btnMobileCam.addEventListener('click', () => {
        mobileCamInput.click();
      });
    }

    if (mobileCamInput) {
      mobileCamInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
          const file = e.target.files[0];
          await this.handleMobileCapturedPhoto(file);
          mobileCamInput.value = '';
        }
      });
    }

    // Chuyển tab trên thanh điều hướng di động (Bottom Navigation)
    document.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    // Nút chia sẻ Zalo / Email qua Web Share API
    const shareExcelBtn = document.getElementById('btnShareExcel');
    if (shareExcelBtn) {
      shareExcelBtn.addEventListener('click', () => this.shareExcelFile());
    }

    // Nút xác nhận sửa nhanh bài thi
    const btnFastFixConfirm = document.getElementById('btnFastFixConfirm');
    if (btnFastFixConfirm) {
      btnFastFixConfirm.addEventListener('click', () => this.confirmFastFix());
    }

    // Nút chấm thử 1 bài mẫu ngay
    const demoBtn = document.getElementById('btnScanDemoSample');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => this.scanSampleDemoSheet());
    }

    // Nút xuất Excel
    const exportExcelBtn = document.getElementById('btnExportExcel');
    if (exportExcelBtn) {
      exportExcelBtn.addEventListener('click', () => this.exportScoreExcel());
    }

    // Nút tải ZIP
    const exportZipBtn = document.getElementById('btnExportZip');
    if (exportZipBtn) {
      exportZipBtn.addEventListener('click', () => this.exportScoreZip());
    }

    // Nút lưu vào cây thư mục máy
    const saveTreeBtn = document.getElementById('btnSaveTreeServer');
    if (saveTreeBtn) {
      saveTreeBtn.addEventListener('click', () => this.saveToDirectoryTree());
    }

    // Nút sao lưu (.omr)
    const backupBtn = document.getElementById('btnBackupExam');
    if (backupBtn) {
      backupBtn.addEventListener('click', () => this.exportBackupFile());
    }

    const hBackupBtn = document.getElementById('btnHeaderBackup');
    if (hBackupBtn) {
      hBackupBtn.addEventListener('click', () => this.exportBackupFile());
    }

    // Nút Xem Bài ở Header & các tab
    const hLookupBtn = document.getElementById('btnHeaderLookupPaper');
    if (hLookupBtn) {
      hLookupBtn.addEventListener('click', () => this.openPaperLookupModal());
    }
    const scanLookupBtn = document.getElementById('btnScanTabLookupPaper');
    if (scanLookupBtn) {
      scanLookupBtn.addEventListener('click', () => this.openPaperLookupModal());
    }
    const resultsLookupBtn = document.getElementById('btnResultsTabLookupPaper');
    if (resultsLookupBtn) {
      resultsLookupBtn.addEventListener('click', () => this.openPaperLookupModal());
    }

    // Nút mở tệp (.omr)
    const backupInput = document.getElementById('backupFileInput');
    const hOpenBtn = document.getElementById('btnHeaderOpen');
    if (hOpenBtn && backupInput) {
      hOpenBtn.addEventListener('click', () => backupInput.click());
    }

    if (backupInput) {
      backupInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.importBackupFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Nút lưu Google Drive / Gửi Email
    const shareBtn = document.getElementById('btnShareResults');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => this.shareResultsModal());
    }

    // Nút Chấm lại toàn bộ bài
    const regradeBtn = document.getElementById('btnRegradeAll');
    if (regradeBtn) {
      regradeBtn.addEventListener('click', () => this.regradeAllSubmissions());
    }

    // Nút Thêm Mã Đề Mới
    const addCodeBtn = document.getElementById('btnAddExamCode');
    if (addCodeBtn) {
      addCodeBtn.addEventListener('click', () => this.promptAddNewExamCode());
    }

    // Nút Xóa Mã Đề Hiện Tại
    const delCodeBtn = document.getElementById('btnDeleteCurrentCode');
    if (delCodeBtn) {
      delCodeBtn.addEventListener('click', () => this.deleteCurrentExamCode());
    }

    // Nút Xuất File MAU DAP AN.xlsx
    const expAnsBtn = document.getElementById('btnExportAnswerExcel');
    if (expAnsBtn) {
      expAnsBtn.addEventListener('click', () => this.exportAnswerKeyExcel());
    }

    // Xóa toàn bộ kết quả chấm (Chỉ xóa khi giáo viên chủ động bấm)
    const clearBtn = document.getElementById('btnClearAll');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearAllGradedPapers());
    }
    const scanClearBtn = document.getElementById('btnScanClearAll');
    if (scanClearBtn) {
      scanClearBtn.addEventListener('click', () => this.clearAllGradedPapers());
    }

    // Modal navigation & Download image buttons
    const prevBtn = document.getElementById('btnPrevReview');
    if (prevBtn) prevBtn.addEventListener('click', () => this.prevReviewItem());

    const nextBtn = document.getElementById('btnNextReview');
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextReviewItem());

    const dlImgBtn = document.getElementById('btnDownloadImage');
    if (dlImgBtn) dlImgBtn.addEventListener('click', () => this.downloadCurrentPaperImage());

    // Phím tắt bàn phím: Mũi tên trái/phải để lật bài, Esc để đóng
    document.addEventListener('keydown', (e) => {
      const modal = document.getElementById('reviewModal');
      if (modal && modal.classList.contains('active')) {
        if (e.key === 'ArrowLeft') this.prevReviewItem();
        else if (e.key === 'ArrowRight') this.nextReviewItem();
        else if (e.key === 'Escape') this.closeReviewModal();
      }
    });
  }

    switchTab(tabId) {
    document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-item').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
    });

    const btn = document.querySelector(`.nav-tab-btn[data-tab="${tabId}"]`);
    const pane = document.getElementById(tabId);
    if (btn && pane) {
      btn.classList.add('active');
      pane.classList.add('active');
    }

    // Nếu rời tab camera thì tắt camera để tiết kiệm pin
    if (tabId !== 'tab-scan' && this.state.cameraStream) {
      this.stopCamera();
    }
  }

  updateSourceUI() {
    const source = this.state.answerSource || 'excel';
    const rExcel = document.querySelector('input[name="ansSourceRadio"][value="excel"]');
    const rDirect = document.querySelector('input[name="ansSourceRadio"][value="direct"]');
    if (rExcel) rExcel.checked = (source === 'excel');
    if (rDirect) rDirect.checked = (source === 'direct');

    const badge = document.getElementById('activeSourceBadge');
    const b2 = document.getElementById('badgeSec2');
    const b3 = document.getElementById('badgeSec3');
    const lblExcel = document.getElementById('lblSourceExcel');
    const lblDirect = document.getElementById('lblSourceDirect');

    if (source === 'excel') {
      if (badge) {
        badge.textContent = `Đang chấm theo Tệp Excel (Mục 2${this.state.currentSheet ? ' - Sheet: ' + this.state.currentSheet : ''})`;
        badge.style.background = '#4f46e5';
      }
      if (b2) b2.style.display = 'inline-block';
      if (b3) b3.style.display = 'none';
      if (lblExcel) { lblExcel.style.background = '#e0e7ff'; lblExcel.style.color = '#3730a3'; lblExcel.style.borderColor = '#6366f1'; }
      if (lblDirect) { lblDirect.style.background = '#ffffff'; lblDirect.style.color = '#475569'; lblDirect.style.borderColor = '#cbd5e1'; }
    } else {
      if (badge) {
        badge.textContent = 'Đang chấm theo Nhập trực tiếp (Mục 3)';
        badge.style.background = '#10b981';
      }
      if (b2) b2.style.display = 'none';
      if (b3) b3.style.display = 'inline-block';
      if (lblDirect) { lblDirect.style.background = '#d1fae5'; lblDirect.style.color = '#065f46'; lblDirect.style.borderColor = '#10b981'; }
      if (lblExcel) { lblExcel.style.background = '#ffffff'; lblExcel.style.color = '#475569'; lblExcel.style.borderColor = '#cbd5e1'; }
    }
  }

  setAnswerSource(source) {
    this.state.answerSource = source;
    if (source === 'excel') {
      if (this.state.excelExamKeys && Object.keys(this.state.excelExamKeys).length > 0) {
        this.state.activeExamKeys = JSON.parse(JSON.stringify(this.state.excelExamKeys));
      }
      this.showToast(`Đã chọn chấm theo Tệp Excel (Mục 2)${this.state.currentSheet ? ' - Sheet: ' + this.state.currentSheet : ''}!`, "info");
    } else {
      this.state.directExamKeys = JSON.parse(JSON.stringify(this.state.activeExamKeys));
      this.showToast("Đã chọn chấm theo Nhập trực tiếp trên Web (Mục 3).", "success");
    }
    this.updateSourceUI();
    this.saveState();
    this.renderAnswerKeyEditor();
  }

  async tryLoadInitialFiles() {
    if (!this.state.answerSource) {
      this.state.answerSource = 'excel';
    }

    // Thử tự động nạp MAU DAP AN.xlsx nếu có sẵn
    if (!this.state.activeExamKeys || Object.keys(this.state.activeExamKeys).length === 0) {
      try {
        const resp = await fetch('/MAU%20DAP%20AN.xlsx');
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array' });
          if (window.excelHandler) {
            window.excelHandler.rawWorkbook = wb;
          }
          this.state.availableSheets = wb.SheetNames;
          this.state.currentSheet = wb.SheetNames.includes('Mau dap an') ? 'Mau dap an' : (wb.SheetNames[0] || 'Mau dap an');
          const parsed = window.excelHandler.parseAnswerKeySheet(wb, this.state.currentSheet);
          this.state.excelExamKeys = parsed;
          this.state.activeExamKeys = JSON.parse(JSON.stringify(parsed));

          // Cập nhật select sheet
          const select = document.getElementById('sheetSelect');
          if (select) {
            select.innerHTML = wb.SheetNames.map(s => `<option value="${s}" ${s === this.state.currentSheet ? 'selected' : ''}>${s}</option>`).join('');
          }
        }
      } catch (e) {
        console.log("Chưa thể tự động nạp MAU DAP AN.xlsx:", e);
      }
    }

    // Nếu vẫn chưa có thì nạp bộ đáp án chuẩn mẫu 1201, 1202, 1203, 1204
    if (!this.state.activeExamKeys || Object.keys(this.state.activeExamKeys).length === 0) {
      this.state.activeExamKeys = {
        "1201": {
          p1: { 1: "C", 2: "B", 3: "C", 4: "D", 5: "A", 6: "B", 7: "B", 8: "D", 9: "D", 10: "C", 11: "A", 12: "B", 13: "C", 14: "A", 15: "D", 16: "A" },
          p2: { 1: "D-S-D-S", 2: "D-D-S-S", 3: "D-D-S-D", 4: "D-S-S-S" },
          p3: { 1: "0,25", 2: "4,6", 3: "1,5", 4: "32,7" }
        },
        "1202": {
          p1: { 1: "B", 2: "C", 3: "A", 4: "B", 5: "D", 6: "C", 7: "B", 8: "B", 9: "A", 10: "D", 11: "C", 12: "A", 13: "D", 14: "C", 15: "A", 16: "D" },
          p2: { 1: "S-D-S-S", 2: "D-D-S-S", 3: "D-D-S-S", 4: "D-S-D-D" },
          p3: { 1: "-0,5", 2: "14,8", 3: "3.5", 4: "30,4" }
        },
        "1203": {
          p1: { 1: "B", 2: "A", 3: "D", 4: "B", 5: "B", 6: "C", 7: "A", 8: "D", 9: "A", 10: "B", 11: "C", 12: "D", 13: "A", 14: "C", 15: "D", 16: "C" },
          p2: { 1: "D-S-S-D", 2: "D-D-S-D", 3: "S-D-S-D", 4: "D-D-S-D" },
          p3: { 1: "-0,1", 2: "3,6", 3: "-3,5", 4: "33,9" }
        },
        "1204": {
          p1: { 1: "C", 2: "B", 3: "B", 4: "A", 5: "D", 6: "C", 7: "A", 8: "D", 9: "A", 10: "B", 11: "A", 12: "D", 13: "C", 14: "B", 15: "D", 16: "A" },
          p2: { 1: "D-S-S-D", 2: "S-D-S-D", 3: "D-D-S-D", 4: "D-D-S-D" },
          p3: { 1: "1,5", 2: "12,1", 3: "2,5", 4: "21,9" }
        }
      };
    }
    this.updateSourceUI();
    this.renderAnswerKeyEditor();

    // Tab Danh Sách học sinh để trống hoàn toàn theo yêu cầu người dùng, khi đính kèm file thì add vào
    if (!this.state.studentList) {
      this.state.studentList = [];
    }
    // Bảng bài chấm để trống hoàn toàn khi khởi động (không tự động nạp bài chấm thử)
    this.renderStudentListTable();
    this.renderGradedTable();
    this.renderScanLookupControls();
    this.renderRecentScanTable();
    this.updateStatsBar();
    this.updateClassBreakdown();
  }

  async handleAnswerFileUpload(file) {
    try {
      const res = await window.excelHandler.readAnswerKeyWorkbook(file);
      this.state.availableSheets = res.sheetNames;
      this.state.currentSheet = res.sheetNames.includes('Mau dap an') ? 'Mau dap an' : res.activeSheet;
      if (this.state.currentSheet !== res.activeSheet) {
        res.examKeys = window.excelHandler.switchAnswerSheet(this.state.currentSheet);
      }
      this.state.excelExamKeys = res.examKeys;
      this.state.activeExamKeys = JSON.parse(JSON.stringify(res.examKeys));
      this.state.answerSource = 'excel';

      // Cập nhật select sheet
      const select = document.getElementById('sheetSelect');
      if (select) {
        select.innerHTML = res.sheetNames.map(s => `<option value="${s}" ${s === this.state.currentSheet ? 'selected' : ''}>${s}</option>`).join('');
      }

      await this.saveState();
      this.updateSourceUI();
      this.renderAnswerKeyEditor();
      this.updateStatsBar();
      this.showToast(`Đã nạp file đáp án! (${Object.keys(res.examKeys).length} mã đề từ sheet "${this.state.currentSheet}")`, "success");
    } catch (err) {
      console.error(err);
      this.showToast("Lỗi khi đọc file đáp án: " + err.message, "danger");
    }
  }

  async clearAnswerFile() {
    const ansInput = document.getElementById('answerFileInput');
    if (ansInput) ansInput.value = '';

    if (window.excelHandler) {
      window.excelHandler.rawWorkbook = null;
    }
    this.state.availableSheets = [];
    this.state.currentSheet = '';
    this.state.excelExamKeys = null;

    const select = document.getElementById('sheetSelect');
    if (select) {
      select.innerHTML = '<option value="">-- Đang soạn trực tiếp --</option>';
    }

    this.setAnswerSource('direct');
  }

  switchAnswerSheet(sheetName) {
    try {
      const keys = window.excelHandler.switchAnswerSheet(sheetName);
      if (keys) {
        this.state.currentSheet = sheetName;
        this.state.excelExamKeys = keys;
        this.state.activeExamKeys = JSON.parse(JSON.stringify(keys));
        this.state.answerSource = 'excel';
        this.updateSourceUI();
        this.renderAnswerKeyEditor();
        this.updateStatsBar();
        this.showToast(`Đã chuyển sang sheet "${sheetName}" (${Object.keys(keys).length} mã đề)`, "info");
      }
    } catch (e) {
      this.showToast("Không thể chuyển sheet: " + e.message, "danger");
    }
  }

  async handleStudentFileUpload(file) {
    try {
      const list = await window.excelHandler.readStudentListWorkbook(file);
      if (!list || list.length === 0) {
        this.showToast("Không tìm thấy danh sách học sinh hợp lệ trong tệp!", "warning");
        return;
      }
      // Ghép / Thêm vào danh sách (nếu trùng SBD thì cập nhật thông tin mới nhất)
      const existingMap = new Map((this.state.studentList || []).map(s => [String(s.sbd).trim(), s]));
      let newCount = 0;
      list.forEach(st => {
        const key = String(st.sbd).trim();
        if (!existingMap.has(key)) newCount++;
        existingMap.set(key, st);
      });
      this.state.studentList = Array.from(existingMap.values());

      // Tự động đồng bộ họ tên & lớp cho các bài đã chấm nếu SBD khớp
      if (this.state.gradedList && this.state.gradedList.length > 0) {
        this.state.gradedList.forEach(item => {
          const match = existingMap.get(String(item.sbd).trim());
          if (match) {
            item.name = match.name;
            item.className = match.className || item.className;
          }
        });
      }

      await this.saveState();
      this.renderStudentListTable();
      this.renderGradedTable();
      this.renderScanLookupControls();
      this.renderRecentScanTable();
      this.updateStatsBar();
      this.updateClassBreakdown();
      this.showToast(`Đã đính kèm thành công! Đã nạp ${list.length} học sinh (Tổng: ${this.state.studentList.length} HS).`, "success");
    } catch (err) {
      console.error(err);
      this.showToast("Lỗi khi đọc danh sách học sinh: " + err.message, "danger");
    }
  }

  async clearStudentFile() {
    const stuInput = document.getElementById('studentFileInput');
    if (stuInput) stuInput.value = '';

    if (!this.state.studentList || this.state.studentList.length === 0) {
      this.showToast("Danh sách học sinh hiện đang trống!", "info");
      return;
    }

    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ danh sách học sinh hiện có không?\n(Khi cần, bạn chỉ việc đính kèm lại tệp Excel)")) {
      this.state.studentList = [];
      await this.saveState();
      this.renderStudentListTable();
      this.updateStatsBar();
      this.showToast("Đã xóa sạch danh sách học sinh hiện có!", "info");
    }
  }

  handleStagedFiles(files) {
    const fileList = Array.from(files).filter(f => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp)$/i.test(f.name));
    if (fileList.length === 0) {
      this.showToast("Không tìm thấy tệp ảnh bài thi nào hợp lệ (JPG, PNG, JPEG)!", "warning");
      return;
    }

    this.showToast(`Đã nhận ${fileList.length} ảnh bài thi! Đang tiến hành rà soát quy cách (SBD, Mã đề)...`, "info");
    this.precheckAllStagedFiles(fileList);
  }

  /**
   * GIAI ĐOẠN 1: TIỀN KIỂM & RÀ SOÁT LỖI QUY CÁCH (PRE-CHECK)
   * Quét nhanh toàn bộ ảnh để nhận diện SBD, Mã đề và phát hiện lỗi trước khi chấm chính thức
   */
  async precheckAllStagedFiles(fileList) {
    const progWrap = document.getElementById('gradingProgressWrap');
    const progBar = document.getElementById('gradingProgressBar');
    const progText = document.getElementById('gradingProgressText');
    const progPercent = document.getElementById('gradingProgressPercent');
    const progStatus = document.getElementById('gradingCurrentStatus');
    const box = document.getElementById('stagedFilesBox');
    const btn = document.getElementById('btnStartGradingAction');

    if (progWrap) progWrap.style.display = 'block';
    if (progBar) progBar.style.width = '0%';
    if (progText) progText.textContent = `Đang rà soát quy cách: 0 / ${fileList.length} bài thi...`;
    if (progPercent) progPercent.textContent = '0%';
    if (progStatus) progStatus.textContent = 'Đang đọc và tiền kiểm tra Số báo danh & Mã đề...';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span> Đang rà soát SBD & Mã đề (${fileList.length} bài)...`;
    }

    this.state.stagedPapers = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const pct = Math.round(((i + 1) / fileList.length) * 100);

      if (progBar) progBar.style.width = `${pct}%`;
      if (progText) progText.textContent = `Đang rà soát bài ${i + 1} / ${fileList.length}: ${file.name}`;
      if (progPercent) progPercent.textContent = `${pct}%`;

      try {
        const item = await this.precheckSingleFile(file, i);
        this.state.stagedPapers.push(item);

        if (progStatus) {
          if (item.isInvalid) {
            const errs = [];
            if (item.hasSbdError) errs.push(item.sbdErrorMsg);
            if (item.hasExamCodeError) errs.push(item.examCodeErrorMsg);
            progStatus.innerHTML = `⚠️ <strong>${file.name}</strong> ➔ <span style="color:#b45309; font-weight:700;">${errs.join(' | ')}</span>`;
          } else {
            progStatus.innerHTML = `✓ <strong>${file.name}</strong> ➔ SBD: <strong>${item.sbd}</strong> | Mã đề: <strong>${item.examCode}</strong> (Hợp lệ)`;
          }
        }
      } catch (err) {
        console.error("Lỗi khi rà soát file", file.name, err);
      }
    }

    if (btn) btn.disabled = false;

    if (progText) {
      progText.textContent = `✓ Đã hoàn tất rà soát quy cách ${this.state.stagedPapers.length} bài thi!`;
    }
    if (progPercent) progPercent.textContent = '100%';

    this.updateStagedPrecheckUI();

    const invalidList = this.state.stagedPapers.filter(p => p.isInvalid);
    if (invalidList.length > 0) {
      this.showToast(`Phát hiện ${invalidList.length} bài thi cần rà soát lại (thiếu SBD/sai mã đề)!`, "warning");
    } else {
      this.showToast(`Tuyệt vời! Toàn bộ ${this.state.stagedPapers.length} bài thi đều hợp lệ. Hãy bấm "Bắt Đầu Chấm Điểm"!`, "success");
    }
  }

  async precheckSingleFile(file, index) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // Nắn thẳng khổ A4 chuẩn
            const normalized = window.omrEngine.normalizeToStandardA4(canvas);
            const workingCanvas = normalized.canvas;
            const cleanImageData = workingCanvas.toDataURL('image/jpeg', 0.88);

            // Trích xuất OMR sơ bộ
            const scanned = window.omrEngine.extractSheetData(
              workingCanvas.getContext('2d'),
              workingCanvas.width,
              workingCanvas.height,
              this.state.activeExamKeys,
              this.state.studentList
            );

            // 1. Kiểm tra Số Báo Danh (8 cột, mỗi cột chỉ tô tối đa 1 ô)
            let hasSbdError = false;
            let sbdErrorMsg = '';
            const rawSbd = String(scanned.sbd || '').trim();

            if (!rawSbd || rawSbd === '' || rawSbd === '________' || rawSbd === '00000000') {
              hasSbdError = true;
              sbdErrorMsg = 'Chưa tô ô Số báo danh';
            } else if (rawSbd.includes('X')) {
              hasSbdError = true;
              sbdErrorMsg = 'Vi phạm: Tô đúp ô trên cột Số báo danh (mỗi cột chỉ được tô 1 ô)';
            } else if (rawSbd.includes('_')) {
              const shadedCount = rawSbd.replace(/_/g, '').length;
              hasSbdError = true;
              sbdErrorMsg = `Tô thiếu chữ số SBD (mới tô ${shadedCount}/8 cột hoặc có ô tô quá mờ: ${rawSbd})`;
            } else if (rawSbd.length < 8) {
              hasSbdError = true;
              sbdErrorMsg = `Tô thiếu chữ số SBD (mới tô ${rawSbd.length}/8 số)`;
            } else if (this.state.studentList && this.state.studentList.length > 0) {
              const found = this.state.studentList.find(s => String(s.sbd).trim() === rawSbd);
              if (!found) {
                hasSbdError = true;
                sbdErrorMsg = `SBD ${rawSbd} không có trong danh sách học sinh`;
              }
            }

            // 2. Kiểm tra Mã Đề Thi (Mã 4 số hoặc Mã 3 số tô 3 cột đầu; mỗi cột chỉ tô tối đa 1 ô)
            let hasExamCodeError = false;
            let examCodeErrorMsg = '';
            const rawCode = String(scanned.examCode || '').trim();

            if (!rawCode || rawCode === '' || rawCode === '____' || rawCode === '___' || rawCode === '000' || rawCode === '0000') {
              hasExamCodeError = true;
              examCodeErrorMsg = 'Chưa tô ô Mã đề thi (hoặc tô quá mờ cả 4 cột)';
            } else if (rawCode.includes('X')) {
              hasExamCodeError = true;
              examCodeErrorMsg = 'Vi phạm: Tô đúp ô trên cột Mã đề thi (mỗi cột chỉ được tô 1 ô)';
            } else if (rawCode.includes('_')) {
              hasExamCodeError = true;
              examCodeErrorMsg = `Tô thiếu cột hoặc có ô tô quá mờ trên Mã đề: ${rawCode}`;
            } else if (rawCode.length !== 3 && rawCode.length !== 4) {
              hasExamCodeError = true;
              examCodeErrorMsg = `Mã đề phải có 3 hoặc 4 chữ số (hiện tại: ${rawCode.length} chữ số)`;
            } else {
              const activeKeys = this.state.activeExamKeys || {};
              if (!activeKeys[rawCode]) {
                const availableCodes = Object.keys(activeKeys).join(', ');
                hasExamCodeError = true;
                examCodeErrorMsg = `Mã đề '${rawCode}' không có trong bộ đáp án đang chấm (chỉ có: ${availableCodes || 'chưa có đáp án'})`;
              }
            }

            const isInvalid = hasSbdError || hasExamCodeError;

            // Tìm thông tin học sinh nếu khớp
            let studentName = '';
            let studentClass = '';
            if (this.state.studentList && this.state.studentList.length > 0) {
              const found = this.state.studentList.find(s => String(s.sbd).trim() === rawSbd);
              if (found) {
                studentName = found.name;
                studentClass = found.className;
              }
            }

            resolve({
              id: 'staged_' + Date.now() + '_' + index,
              fileName: file.name,
              fileIndex: index,
              cleanImage: cleanImageData,
              scannedData: scanned,
              sbd: rawSbd,
              examCode: rawCode,
              hasSbdError,
              sbdErrorMsg,
              hasExamCodeError,
              examCodeErrorMsg,
              isInvalid,
              name: studentName,
              className: studentClass
            });
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  updateStagedPrecheckUI() {
    const list = this.state.stagedPapers || [];
    const countBadge = document.getElementById('stagedCountBadge');
    const box = document.getElementById('stagedFilesBox');
    const btn = document.getElementById('btnStartGradingAction');

    if (list.length === 0) return;

    const invalidList = list.filter(p => p.isInvalid);
    const validCount = list.length - invalidList.length;

    if (countBadge) {
      if (invalidList.length > 0) {
        countBadge.textContent = `⚠️ ${invalidList.length} bài cần rà soát / ${list.length} bài`;
        countBadge.style.background = '#fef3c7';
        countBadge.style.color = '#92400e';
      } else {
        countBadge.textContent = `✅ ${list.length} bài hợp lệ`;
        countBadge.style.background = '#dcfce7';
        countBadge.style.color = '#15803d';
      }
    }

    if (box) {
      if (invalidList.length > 0) {
        let cardsHtml = '';
        invalidList.slice(0, 6).forEach((p, idx) => {
          const originalIdx = list.indexOf(p);
          let badgesHtml = '';
          if (p.hasSbdError) {
            badgesHtml += `<span class="violation-badge violation-badge-danger">🔴 ${p.sbdErrorMsg}</span>`;
          } else {
            badgesHtml += `<span class="violation-badge" style="background:#e0e7ff; color:#3730a3;">✓ SBD: ${p.sbd}</span>`;
          }
          if (p.hasExamCodeError) {
            badgesHtml += `<span class="violation-badge violation-badge-warning">🟠 ${p.examCodeErrorMsg}</span>`;
          } else {
            badgesHtml += `<span class="violation-badge" style="background:#e0e7ff; color:#3730a3;">✓ Mã đề: ${p.examCode}</span>`;
          }

          cardsHtml += `
            <div class="violation-card-item">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span style="font-weight:700; color:#1e293b; font-size:0.85rem;">📄 ${p.fileName}</span>
                <div style="display:inline-flex; gap:5px; flex-wrap:wrap;">
                  ${badgesHtml}
                </div>
              </div>
              <button class="btn btn-outline btn-sm" onclick="window.app.openPrecheckModal(${originalIdx})"
                      style="color:#d97706; border-color:#f59e0b; padding:3px 12px; font-weight:700; font-size:0.78rem; border-radius:6px; background:#fffbeb;">
                🔍 Soi & Sửa A4
              </button>
            </div>
          `;
        });

        if (invalidList.length > 6) {
          cardsHtml += `
            <div style="text-align:center; padding:6px; font-size:0.8rem; color:#92400e; font-style:italic; font-weight:600;">
              ... và còn ${invalidList.length - 6} bài thi khác cần rà soát thông tin (bấm nút bên dưới để mở duyệt lần lượt từng bài)
            </div>
          `;
        }

        box.innerHTML = `
          <div style="background:#fffbeb; border:1.5px solid #fde68a; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 4px 12px rgba(245, 158, 11, 0.1);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #fed7aa;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:1.5rem;">⚠️</span>
                <div>
                  <div style="font-weight:800; font-size:1rem; color:#9a3412;">
                    PHÁT HIỆN ${invalidList.length} BÀI THI CẦN RÀ SOÁT QUY CÁCH
                  </div>
                  <div style="font-size:0.82rem; color:#78350f; margin-top:2px;">
                    Học sinh chưa tô SBD, tô thiếu số, hoặc mã đề không có trong đáp án. Hãy soi cả trang A4 để xem chữ viết tay đối chiếu Danh sách lớp.
                  </div>
                </div>
              </div>
              <div style="display:flex; gap:8px;">
                <span class="badge" style="background:#dcfce7; color:#166534; font-weight:700; font-size:0.8rem; padding:5px 12px; border-radius:20px;">
                  ✓ ${validCount} bài hợp lệ
                </span>
                <span class="badge" style="background:#fee2e2; color:#991b1b; font-weight:700; font-size:0.8rem; padding:5px 12px; border-radius:20px;">
                  ⚠️ ${invalidList.length} bài vi phạm
                </span>
              </div>
            </div>

            <div style="margin-bottom:14px;">
              ${cardsHtml}
            </div>

            <div>
              <button class="btn btn-warning" onclick="window.app.openPrecheckModal()" 
                      style="width:100%; font-weight:800; font-size:0.98rem; background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color:#fff; box-shadow:0 4px 14px rgba(245,158,11,0.45); padding:12px; border-radius:8px; border:none; cursor:pointer;">
                🔍 BẤM VÀO ĐÂY ĐỂ RÀ SOÁT TẤT CẢ ${invalidList.length} BÀI LỖI (SOI TOÀN BỘ TRANG A4) ➡
              </button>
            </div>
          </div>
        `;
      } else {
        box.innerHTML = `
          <div style="background:#f0fdf4; border:1.5px solid #bbf7d0; border-radius:12px; padding:14px 18px; color:#15803d; box-shadow:0 4px 12px rgba(16, 185, 129, 0.08);">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.5rem;">✅</span>
              <div>
                <div style="font-weight:800; font-size:0.98rem; color:#166534;">
                  TẤT CẢ ${list.length} BÀI THI ĐỀU HỢP LỆ VÀ ĐÚNG QUY ĐỊNH!
                </div>
                <div style="font-size:0.82rem; color:#15803d; margin-top:2px;">
                  Số báo danh và Mã đề đều chuẩn xác. Bạn hãy bấm nút lớn bên dưới để <strong>BẮT ĐẦU CHẤM ĐIỂM CHÍNH THỨC</strong>!
                </div>
              </div>
            </div>
          </div>
        `;
      }
    }

    if (btn) {
      btn.innerHTML = `<span>🚀</span> BẤM VÀO ĐÂY ĐỂ BẮT ĐẦU CHẤM ĐIỂM (${list.length} BÀI THI)`;
      btn.style.boxShadow = invalidList.length > 0 ? "0 0 15px rgba(245, 158, 11, 0.4)" : "0 0 15px rgba(16, 185, 129, 0.6)";
    }
  }

  // ==========================================
  // MODAL RÀ SOÁT & SỬA BÀI LỖI QUY CÁCH (A4)
  // ==========================================
  openPrecheckModal(targetIndex = null) {
    const list = this.state.stagedPapers || [];
    if (list.length === 0) {
      this.showToast("Chưa có bài thi nào được nạp!", "warning");
      return;
    }

    const invalidIndices = [];
    list.forEach((p, idx) => {
      if (p.isInvalid) invalidIndices.push(idx);
    });

    if (invalidIndices.length === 0 && targetIndex === null) {
      this.showToast("Toàn bộ các bài thi đều đã hợp lệ, không có bài nào cần sửa!", "success");
      return;
    }

    if (targetIndex !== null) {
      this.state.currentPrecheckIndex = targetIndex;
    } else {
      this.state.currentPrecheckIndex = invalidIndices[0] !== undefined ? invalidIndices[0] : 0;
    }

    this.state.currentPrecheckZoom = 1.0;
    this.state.precheckSearchQuery = '';
    this.renderCurrentPrecheck();

    const modal = document.getElementById('precheckModal');
    if (modal) modal.classList.add('active');
  }

  renderCurrentPrecheck() {
    const list = this.state.stagedPapers || [];
    const idx = this.state.currentPrecheckIndex;
    if (idx < 0 || idx >= list.length) return;

    const paper = list[idx];
    const invalidList = list.filter(p => p.isInvalid);
    const currErrRank = invalidList.findIndex(p => p.id === paper.id);

    const progBadge = document.getElementById('precheckProgressBadge');
    if (progBadge) {
      if (paper.isInvalid) {
        progBadge.textContent = `Bài lỗi ${currErrRank + 1} / ${invalidList.length} bài lỗi (Tổng ${list.length} bài)`;
        progBadge.style.background = '#fee2e2';
        progBadge.style.color = '#991b1b';
      } else {
        progBadge.textContent = `Bài ${idx + 1} / ${list.length} (✓ Đã hợp lệ)`;
        progBadge.style.background = '#dcfce7';
        progBadge.style.color = '#166534';
      }
    }

    const body = document.getElementById('precheckModalBody');
    if (!body) return;

    const activeKeys = this.state.activeExamKeys || {};
    const codeList = Object.keys(activeKeys);
    let codeOptions = codeList.map(c => `
      <option value="${c}" ${c === paper.examCode ? 'selected' : ''}>Mã đề ${c}</option>
    `).join('');

    if (paper.examCode && !activeKeys[paper.examCode]) {
      codeOptions = `<option value="${paper.examCode}" selected>⚠️ ${paper.examCode} (Không có trong đáp án)</option>` + codeOptions;
    }

    const stuList = this.state.studentList || [];
    const q = (this.state.precheckSearchQuery || '').trim().toLowerCase();
    let stuSuggestionsHtml = '';

    if (stuList.length > 0) {
      const filteredStu = q 
        ? stuList.filter(s => (s.name && s.name.toLowerCase().includes(q)) || (s.sbd && s.sbd.includes(q)) || (s.className && s.className.toLowerCase().includes(q)))
        : stuList.slice(0, 8);

      stuSuggestionsHtml = `
        <div style="font-size:0.75rem; color:#475569; font-weight:700; margin-bottom:4px;">
          👥 Gợi ý học sinh từ Danh Sách Lớp (${stuList.length} HS) — Bấm vào để tự điền:
        </div>
        <div style="max-height:140px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; padding:4px;">
          ${filteredStu.map(s => `
            <div class="stu-pick-row" onclick="window.app.onSelectPrecheckStudent('${s.sbd}')"
                 style="padding:5px 8px; border-radius:4px; cursor:pointer; font-size:0.82rem; display:flex; justify-content:space-between; align-items:center; transition:background 0.15s; margin-bottom:2px;"
                 onmouseover="this.style.background='#e0e7ff'" onmouseout="this.style.background='transparent'">
              <div>
                <strong style="color:#1e1b4b;">${s.name}</strong>
                <span class="class-tag-pill" style="font-size:0.7rem; margin-left:4px;">${s.className}</span>
              </div>
              <span class="badge-tag" style="background:#e0e7ff; color:#3730a3; font-weight:700; font-family:monospace;">SBD: ${s.sbd}</span>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      stuSuggestionsHtml = `
        <div style="font-size:0.75rem; color:#64748b; font-style:italic; background:#f1f5f9; padding:6px 10px; border-radius:6px;">
          (Chưa nạp Danh sách học sinh ở Tab 2. Bạn có thể nhập trực tiếp Số báo danh 8 chữ số bên dưới)
        </div>
      `;
    }

    body.innerHTML = `
      <div class="review-grid-layout" style="height:calc(88vh - 120px);">
        <!-- Cột Trái: Toàn bộ ảnh trang A4 kèm thanh thu phóng % -->
        <div class="review-image-pane">
          <div class="review-image-toolbar" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
            <span style="font-weight:700; font-size:0.82rem; color:#f8fafc;">📷 ${paper.fileName}</span>
            <div class="zoom-toolbar">
              <button class="btn-zoom ${this.state.currentPrecheckZoom === 1.0 ? 'active' : ''}" onclick="window.app.setPrecheckZoom(1.0)" title="Vừa chiều rộng trang A4">📐 Vừa trang</button>
              <button class="btn-zoom ${this.state.currentPrecheckZoom === 0.75 ? 'active' : ''}" onclick="window.app.setPrecheckZoom(0.75)">75%</button>
              <button class="btn-zoom ${this.state.currentPrecheckZoom === 1.0 ? 'active' : ''}" onclick="window.app.setPrecheckZoom(1.0)">100%</button>
              <button class="btn-zoom ${this.state.currentPrecheckZoom === 1.25 ? 'active' : ''}" onclick="window.app.setPrecheckZoom(1.25)">125%</button>
              <button class="btn-zoom ${this.state.currentPrecheckZoom === 1.5 ? 'active' : ''}" onclick="window.app.setPrecheckZoom(1.5)" title="Soi rõ Họ tên & SBD viết tay">🔍 150%</button>
              <button class="btn-zoom ${this.state.currentPrecheckZoom === 2.0 ? 'active' : ''}" onclick="window.app.setPrecheckZoom(2.0)">200%</button>
              <div style="display:inline-flex; align-items:center; gap:2px; background:rgba(0,0,0,0.35); padding:2px 5px; border-radius:5px; margin-left:3px;">
                <button class="btn-zoom" style="padding:1px 6px;" onclick="window.app.stepPrecheckZoom(-0.1)" title="Thu nhỏ 10%">-</button>
                <span id="precheckZoomPercentBadge" style="font-size:0.75rem; font-weight:800; color:#fbbf24; min-width:38px; text-align:center;">${Math.round((this.state.currentPrecheckZoom || 1.0) * 100)}%</span>
                <button class="btn-zoom" style="padding:1px 6px;" onclick="window.app.stepPrecheckZoom(0.1)" title="Phóng to 10%">+</button>
              </div>
            </div>
          </div>
          <div class="review-image-scroll" id="precheckImgContainer" style="overflow:auto; height:calc(100% - 44px); background:#1e293b; text-align:center; padding:10px;">
            <img id="precheckPaperImg" src="${paper.cleanImage}" 
                 style="transform: scale(${this.state.currentPrecheckZoom || 1.0}); transform-origin: top center; transition: transform 0.15s ease; max-width:100%; box-shadow:0 6px 20px rgba(0,0,0,0.5);" />
          </div>
        </div>

        <!-- Cột Phải: Đối chiếu & Sửa lỗi thông minh -->
        <div class="review-details-pane" style="overflow-y:auto; padding-right:6px;">
          <!-- Hộp thông báo lỗi -->
          <div style="background:${paper.isInvalid ? '#fee2e2' : '#dcfce7'}; border:1.5px solid ${paper.isInvalid ? '#f87171' : '#86efac'}; border-radius:10px; padding:12px; margin-bottom:14px;">
            <div style="font-weight:800; font-size:0.95rem; color:${paper.isInvalid ? '#991b1b' : '#166534'}; display:flex; align-items:center; gap:6px;">
              <span>${paper.isInvalid ? '⚠️ CẦN CHỈNH SỬA QUY CÁCH' : '✅ BÀI THI HỢP LỆ'}</span>
            </div>
            <ul style="margin:6px 0 0; padding-left:18px; font-size:0.83rem; color:${paper.isInvalid ? '#b91c1c' : '#15803d'};">
              ${paper.hasSbdError ? `<li><strong>Lỗi SBD:</strong> ${paper.sbdErrorMsg}</li>` : `<li>✓ Số báo danh: <strong>${paper.sbd}</strong></li>`}
              ${paper.hasExamCodeError ? `<li><strong>Lỗi Mã đề:</strong> ${paper.examCodeErrorMsg}</li>` : `<li>✓ Mã đề thi: <strong>${paper.examCode}</strong></li>`}
            </ul>
          </div>

          <!-- Phần tra cứu và sửa SBD -->
          <div class="review-section-box" style="margin-bottom:12px;">
            <div class="review-section-title">
              <span>🪪 1. Tra cứu & Sửa Số Báo Danh (SBD)</span>
            </div>

            <!-- Ô tìm kiếm học sinh theo tên -->
            <div style="margin-bottom:8px;">
              <label style="font-size:0.78rem; font-weight:700; color:#334155; display:block; margin-bottom:3px;">
                🔎 Tìm nhanh theo Họ tên viết tay bút mực trên bài A4:
              </label>
              <input type="text" id="precheckSearchStudentInput" class="form-control" 
                     placeholder="Gõ họ tên học sinh để tra SBD (ví dụ: Ngọc, Anh, Bảo)..." 
                     value="${this.state.precheckSearchQuery || ''}"
                     oninput="window.app.onPrecheckSearchInput(this.value)"
                     style="font-size:0.85rem; padding:6px 10px;">
            </div>

            ${stuSuggestionsHtml}

            <!-- Ô nhập trực tiếp SBD -->
            <div style="margin-top:10px; display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <div>
                <label style="font-size:0.78rem; font-weight:700; color:#334155; display:block; margin-bottom:3px;">
                  Số Báo Danh (8 số):
                </label>
                <input type="text" id="precheckEditSbd" maxlength="8" class="form-control"
                       value="${paper.sbd || ''}"
                       placeholder="Ví dụ: 00012045"
                       style="font-family:monospace; font-weight:800; font-size:1rem; text-align:center; border:2px solid #6366f1;">
              </div>
              <div>
                <label style="font-size:0.78rem; font-weight:700; color:#334155; display:block; margin-bottom:3px;">
                  Họ tên học sinh:
                </label>
                <input type="text" id="precheckEditName" class="form-control"
                       value="${paper.name || ''}"
                       placeholder="Họ và tên..."
                       style="font-weight:700; font-size:0.85rem;">
              </div>
            </div>
          </div>

          <!-- Phần sửa Mã Đề -->
          <div class="review-section-box" style="margin-bottom:14px;">
            <div class="review-section-title">
              <span>📑 2. Kiểm tra & Chọn Mã Đề Thi Đúng</span>
            </div>
            <label style="font-size:0.78rem; font-weight:700; color:#334155; display:block; margin-bottom:4px;">
              Chọn mã đề hợp lệ trong bộ đáp án (theo chữ viết tay trên bài thi):
            </label>
            <select id="precheckSelectExamCode" class="form-control" style="font-weight:700; font-size:0.95rem; border:2px solid #6366f1;">
              <option value="">-- Bấm chọn mã đề đúng --</option>
              ${codeOptions}
            </select>
            <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">
              Mã đề đang tô trên bài: <strong style="color:#1e1b4b;">${paper.examCode || '(Chưa tô)'}</strong>
            </div>
          </div>

          <!-- Nút bấm xác nhận & lật bài tiếp theo -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button class="btn btn-primary" onclick="window.app.saveAndNextPrecheckPaper()"
                    style="width:100%; font-weight:800; font-size:1rem; padding:12px; background:linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); box-shadow:0 4px 12px rgba(79,70,229,0.35);">
              <span>💾</span> LƯU & CHUYỂN BÀI LỖI TIẾP THEO (➡)
            </button>
            <div style="display:flex; justify-content:space-between; gap:6px;">
              <button class="btn btn-outline btn-sm" onclick="window.app.prevPrecheckPaper()" style="flex:1;">⬅ Bài trước</button>
              <button class="btn btn-outline btn-sm" onclick="window.app.nextPrecheckPaper()" style="flex:1;">Bài sau ➡</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  onPrecheckSearchInput(query) {
    this.state.precheckSearchQuery = query;
    this.renderCurrentPrecheck();
    const input = document.getElementById('precheckSearchStudentInput');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  onSelectPrecheckStudent(sbd) {
    const stuList = this.state.studentList || [];
    const found = stuList.find(s => String(s.sbd).trim() === sbd);
    if (!found) return;

    const inputSbd = document.getElementById('precheckEditSbd');
    const inputName = document.getElementById('precheckEditName');
    if (inputSbd) inputSbd.value = found.sbd;
    if (inputName) inputName.value = found.name;

    this.showToast(`Đã chọn học sinh: ${found.name} (SBD: ${found.sbd})!`, "info");
  }

  saveAndNextPrecheckPaper() {
    const list = this.state.stagedPapers || [];
    const idx = this.state.currentPrecheckIndex;
    if (idx < 0 || idx >= list.length) return;

    const paper = list[idx];
    const inputSbd = document.getElementById('precheckEditSbd');
    const inputName = document.getElementById('precheckEditName');
    const selectCode = document.getElementById('precheckSelectExamCode');

    if (!inputSbd || !selectCode) return;

    let newSbd = inputSbd.value.trim();
    let newName = inputName ? inputName.value.trim() : '';
    let newCode = selectCode.value.trim();

    if (!newSbd) {
      this.showToast("Vui lòng nhập Số báo danh cho bài thi!", "warning");
      inputSbd.focus();
      return;
    }

    if (/^\d+$/.test(newSbd) && newSbd.length < 8) {
      newSbd = newSbd.padStart(8, '0');
      inputSbd.value = newSbd;
    }

    if (!newCode) {
      this.showToast("Vui lòng chọn Mã đề thi!", "warning");
      selectCode.focus();
      return;
    }

    paper.sbd = newSbd;
    paper.examCode = newCode;
    paper.scannedData.sbd = newSbd;
    paper.scannedData.examCode = newCode;

    if (this.state.studentList && this.state.studentList.length > 0) {
      const found = this.state.studentList.find(s => String(s.sbd).trim() === newSbd);
      if (found) {
        paper.name = found.name;
        paper.className = found.className;
      } else {
        paper.name = newName || ("Học sinh SBD " + newSbd);
        paper.className = "Tự do";
      }
    } else {
      paper.name = newName || ("Học sinh SBD " + newSbd);
      paper.className = "Tự do";
    }

    paper.hasSbdError = false;
    paper.sbdErrorMsg = '';
    paper.hasExamCodeError = false;
    paper.examCodeErrorMsg = '';

    const activeKeys = this.state.activeExamKeys || {};
    if (!activeKeys[newCode]) {
      paper.hasExamCodeError = true;
      paper.examCodeErrorMsg = `Mã đề '${newCode}' không có trong bộ đáp án đang chấm`;
    }

    paper.isInvalid = paper.hasSbdError || paper.hasExamCodeError;

    this.showToast(`✓ Đã lưu bài: SBD ${newSbd} - Mã đề ${newCode}!`, "success");
    this.updateStagedPrecheckUI();

    const remainingInvalid = list.map((p, i) => ({ p, i })).filter(item => item.p.isInvalid);
    if (remainingInvalid.length > 0) {
      const nextItem = remainingInvalid.find(item => item.i > idx) || remainingInvalid[0];
      this.state.currentPrecheckIndex = nextItem.i;
      this.state.precheckSearchQuery = '';
      this.renderCurrentPrecheck();
    } else {
      this.closePrecheckModal();
      this.showToast("🎉 Chúc mừng! Toàn bộ bài thi đã được rà soát hợp lệ. Hãy bấm 'BẮT ĐẦU CHẤM ĐIỂM CHÍNH THỨC'!", "success");
    }
  }

  nextPrecheckPaper() {
    const list = this.state.stagedPapers || [];
    if (list.length === 0) return;
    this.state.currentPrecheckIndex = (this.state.currentPrecheckIndex + 1) % list.length;
    this.state.precheckSearchQuery = '';
    this.renderCurrentPrecheck();
  }

  prevPrecheckPaper() {
    const list = this.state.stagedPapers || [];
    if (list.length === 0) return;
    this.state.currentPrecheckIndex = (this.state.currentPrecheckIndex - 1 + list.length) % list.length;
    this.state.precheckSearchQuery = '';
    this.renderCurrentPrecheck();
  }

  setPrecheckZoom(level) {
    this.state.currentPrecheckZoom = level;
    const img = document.getElementById('precheckPaperImg');
    if (img) {
      img.style.transform = `scale(${level})`;
      img.style.transformOrigin = 'top center';
    }
    const badge = document.getElementById('precheckZoomPercentBadge');
    if (badge) badge.textContent = `${Math.round(level * 100)}%`;

    const btns = document.querySelectorAll('#precheckModal .btn-zoom');
    btns.forEach(b => {
      const txt = b.textContent.trim();
      b.classList.toggle('active', txt === `${Math.round(level * 100)}%` || (level === 1.0 && txt.includes('Vừa trang')));
    });

    const container = document.getElementById('precheckImgContainer');
    if (container && level >= 1.2) {
      container.scrollTop = 0;
    }
  }

  stepPrecheckZoom(delta) {
    const cur = this.state.currentPrecheckZoom || 1.0;
    const next = Math.max(0.5, Math.min(3.0, Math.round((cur + delta) * 10) / 10));
    this.setPrecheckZoom(next);
  }

  zoomPrecheckImage(delta) {
    this.stepPrecheckZoom(delta);
  }

  resetZoomPrecheckImage() {
    this.setPrecheckZoom(1.0);
  }

  closePrecheckModal() {
    const modal = document.getElementById('precheckModal');
    if (modal) modal.classList.remove('active');
  }

  /**
   * GIAI ĐOẠN 2: BẮT ĐẦU CHẤM ĐIỂM CHÍNH THỨC
   * Chỉ chấm điểm sau khi giáo viên đã hoàn tất việc rà soát quy cách (hoặc bấm xác nhận)
   */
  async startGradingProcess() {
    let list = this.state.stagedPapers || [];

    if (list.length === 0) {
      this.showToast("Đang mở hộp thoại chọn thư mục ảnh bài thi...", "info");
      const folderInput = document.getElementById('folderImagesInput');
      if (folderInput) folderInput.click();
      return;
    }

    const invalidList = list.filter(p => p.isInvalid);
    if (invalidList.length > 0) {
      const ok = confirm(`⚠️ CẢNH BÁO:\nHiện vẫn còn ${invalidList.length} bài thi chưa đúng quy định (thiếu SBD hoặc sai mã đề).\n\nBạn có muốn bấm 'Hủy' để rà soát và sửa lỗi trên trang A4, hay bấm 'OK' để vẫn tiếp tục chấm toàn bộ?`);
      if (!ok) {
        this.openPrecheckModal();
        return;
      }
    }

    this.closePrecheckModal();

    const progWrap = document.getElementById('gradingProgressWrap');
    const progBar = document.getElementById('gradingProgressBar');
    const progText = document.getElementById('gradingProgressText');
    const progPercent = document.getElementById('gradingProgressPercent');
    const progStatus = document.getElementById('gradingCurrentStatus');
    const btn = document.getElementById('btnStartGradingAction');

    if (progWrap) progWrap.style.display = 'block';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span> Đang chấm điểm chính thức (0 / ${list.length})...`;
    }

    let successCount = 0;
    for (let i = 0; i < list.length; i++) {
      const paper = list[i];
      const pct = Math.round(((i + 1) / list.length) * 100);

      if (progBar) progBar.style.width = `${pct}%`;
      if (progText) progText.textContent = `Đang chấm bài ${i + 1} / ${list.length}: SBD ${paper.sbd} (Mã đề ${paper.examCode})`;
      if (progPercent) progPercent.textContent = `${pct}%`;

      try {
        const key = (this.state.activeExamKeys && this.state.activeExamKeys[paper.examCode]) 
          ? this.state.activeExamKeys[paper.examCode] 
          : null;

        const grading = window.omrEngine.calculateGrade(paper.scannedData, key, this.state.gradingRules);

        // Nạp cleanImage lên canvas để vẽ overlay các ô đúng / sai an toàn
        let markedImageData = paper.cleanImage;
        try {
          const img = new Image();
          await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = () => resolve(); // Nếu ảnh lỗi thì tiếp tục không làm gián đoạn
            setTimeout(resolve, 3000);     // Tránh treo
            img.src = paper.cleanImage;
          });

          if (img.naturalWidth) {
            const cvs = document.createElement('canvas');
            cvs.width = img.naturalWidth || 1662;
            cvs.height = img.naturalHeight || 2346;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(img, 0, 0);

            window.omrEngine.drawOverlayMarks(ctx, cvs.width, cvs.height, paper.scannedData, grading);
            markedImageData = cvs.toDataURL('image/jpeg', 0.88);
          }
        } catch (drawErr) {
          console.warn("Lỗi khi vẽ overlay:", drawErr);
        }

        let notes = grading.notes || "";
        if (paper.hasSbdError) {
          notes = notes ? `${paper.sbdErrorMsg}; ${notes}` : paper.sbdErrorMsg;
        }
        if (!key) {
          const wKey = `Chưa có đáp án mã đề ${paper.examCode}`;
          notes = notes ? `${wKey}; ${notes}` : wKey;
        }

        const submission = {
          id: 'sub_' + Date.now() + '_' + i + '_' + Math.floor(Math.random() * 1000),
          timestamp: new Date().toISOString(),
          sbd: paper.sbd,
          name: paper.name || ("Học sinh SBD " + paper.sbd),
          className: paper.className || (this.state.examMeta && this.state.examMeta.className) || "Chưa phân lớp",
          examCode: paper.examCode,
          p1Score: grading.p1Score,
          p2Score: grading.p2Score,
          p3Score: grading.p3Score,
          totalScore: grading.totalScore,
          notes: notes,
          scannedData: paper.scannedData,
          details: grading.details,
          cleanImage: paper.cleanImage,
          previewImage: markedImageData
        };

        await this.addGradedSubmission(submission);
        successCount++;

        if (progStatus) {
          progStatus.innerHTML = `✓ <strong>${paper.fileName}</strong> ➔ SBD: <strong>${submission.sbd}</strong> | Mã đề: <strong>${submission.examCode}</strong> | Điểm: <strong style="color:${submission.totalScore >= 5 ? '#10b981' : '#ef4444'}">${submission.totalScore.toFixed(2)}đ</strong>`;
        }
      } catch (err) {
        console.error("Lỗi khi chấm điểm bài", paper.fileName, err);
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>🚀</span> BẤM VÀO ĐÂY ĐỂ TIẾP TỤC CHẤM ĐỢT KHÁC`;
      btn.style.boxShadow = "";
    }

    if (progText) {
      progText.textContent = `✓ Đã hoàn tất chấm điểm ${successCount} / ${list.length} bài thi!`;
    }
    if (progPercent) progPercent.textContent = `100%`;

    const stagedBox = document.getElementById('stagedFilesBox');
    if (stagedBox) {
      stagedBox.innerHTML = `<span style="color:#059669; font-weight:700;">✓ Đã hoàn tất chấm ${successCount} bài thi! Chuyển sang Tab "Bảng Điểm Đầy Đủ" để xem hoặc bấm "👁️ Xem bài" bên dưới.</span>`;
    }

    this.state.stagedPapers = [];
    const countBadge = document.getElementById('stagedCountBadge');
    if (countBadge) countBadge.textContent = '';

    this.showToast(`🎉 Đã hoàn tất chấm điểm chính thức ${successCount} bài thi!`, "success");
    this.renderRecentScanTable();
    this.renderGradedTable();
    this.updateStatsBar();
    this.updateClassBreakdown();

    // Tự động chuyển sang Tab Bảng Điểm Tab 4
    this.switchTab('tab-results');
  }

  async loadSampleGradedPapersIfEmpty() {
    // Không tự động nạp bài mẫu giả lập để bảng điểm luôn sạch sẽ khi mở app
    return;
  }

  async createSimulatedSubmission(sbd, name, className, examCode) {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1130;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = "#fafaf9";
    ctx.fillRect(0, 0, 800, 1130);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(15, 15, 770, 1100);

    ctx.fillStyle = "#000000";
    ctx.fillRect(20, 20, 26, 26);
    ctx.fillRect(754, 20, 26, 26);
    ctx.fillRect(20, 1084, 26, 26);
    ctx.fillRect(754, 1084, 26, 26);

    for (let y = 110; y < 1060; y += 38) {
      ctx.fillRect(766, y, 14, 5);
    }

    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText((this.state.examMeta.school || "TRƯỜNG PT THỰC HÀNH SƯ PHẠM").toUpperCase(), 60, 42);

    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PHIẾU TRẢ LỜI TRẮC NGHIỆM (CHUẨN 2025)", 340, 70);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Môn: " + (this.state.examMeta.subject || "Toán Học") + " • " + (this.state.examMeta.examName || "Kỳ Thi Giữa Kỳ"), 340, 88);

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(60, 105, 340, 50);
    ctx.strokeStyle = "#94a3b8";
    ctx.strokeRect(60, 105, 340, 50);
    ctx.fillStyle = "#334155";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Họ và tên: ${name}`, 70, 126);
    ctx.fillText(`Lớp: ${className}   Phòng thi: 01   Ngày: ${this.state.examMeta.examDate || "15/10/2026"}`, 70, 145);

    ctx.strokeRect(420, 105, 170, 50);
    ctx.fillText("SỐ BÁO DANH", 430, 122);
    ctx.fillText("MÃ ĐỀ THI", 520, 122);
    ctx.font = "bold 15px monospace";
    ctx.fillStyle = "#0f172a";
    ctx.fillText(sbd, 430, 144);
    ctx.fillText(examCode, 525, 144);

    for (let q = 1; q <= 40; q++) {
      const isCol1 = q <= 20;
      const colStartX = isCol1 ? 60 : 410;
      const rowIdx = isCol1 ? (q - 1) : (q - 21);
      const cy = 220 + rowIdx * 21;
      ctx.fillStyle = "#475569";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText((q < 10 ? "0" + q : q) + ".", colStartX, cy + 4);

      ['A', 'B', 'C', 'D'].forEach((opt, oIdx) => {
        const cx = colStartX + 52 + oIdx * 28;
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    const students = [{ sbd, name, className }];
    const result = await window.omrEngine.processSheetCanvas(
      canvas,
      this.state.activeExamKeys,
      students,
      this.state.gradingRules
    );
    result.sbd = sbd;
    result.name = name;
    result.className = className;
    result.examCode = examCode;
    return result;
  }

  async processSingleImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const result = await window.omrEngine.processSheetCanvas(
              canvas,
              this.state.activeExamKeys,
              this.state.studentList,
              this.state.gradingRules
            );

            await this.addGradedSubmission(result);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async scanSampleDemoSheet() {
    this.showToast("Đang mô phỏng quét phiếu mẫu 2025...", "info");
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1130;
    const ctx = canvas.getContext('2d');

    // 1. Nền giấy thi hơi ngà thực tế
    ctx.fillStyle = "#fafaf9";
    ctx.fillRect(0, 0, 800, 1130);

    // Đường viền trang
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(15, 15, 770, 1100);

    // 4 góc định vị đen OMR chuẩn
    ctx.fillStyle = "#000000";
    ctx.fillRect(20, 20, 26, 26);
    ctx.fillRect(754, 20, 26, 26);
    ctx.fillRect(20, 1084, 26, 26);
    ctx.fillRect(754, 1084, 26, 26);

    // Vạch nhịp OMR mép phải
    for (let y = 110; y < 1060; y += 38) {
      ctx.fillRect(766, y, 14, 5);
    }

    // Tiêu đề phiếu thi
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText((this.state.examMeta.school || "TRƯỜNG PT THỰC HÀNH SƯ PHẠM").toUpperCase(), 60, 42);

    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PHIẾU TRẢ LỜI TRẮC NGHIỆM (CHUẨN 2025)", 340, 70);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Môn: " + (this.state.examMeta.subject || "Toán Học") + " • " + (this.state.examMeta.examName || "Kỳ Thi Giữa Kỳ"), 340, 88);

    // Khung SBD & Mã đề
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(60, 105, 340, 50);
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.strokeRect(60, 105, 340, 50);

    ctx.fillStyle = "#334155";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Họ và tên thí sinh: .....................................................", 70, 126);
    ctx.fillText("Lớp: .............. Phòng thi: ............ Ngày thi: " + (this.state.examMeta.examDate || "15/10/2026"), 70, 145);

    // Khung Mã đề & SBD đồ họa
    ctx.strokeRect(420, 105, 170, 50);
    ctx.fillText("SỐ BÁO DANH", 430, 122);
    ctx.fillText("MÃ ĐỀ THI", 520, 122);
    ctx.font = "bold 15px monospace";
    ctx.fillStyle = "#0f172a";
    ctx.fillText("12000001", 430, 144);
    ctx.fillText("1201", 525, 144);

    // Tiêu đề PHẦN I
    ctx.fillStyle = "#1e1b4b";
    ctx.fillRect(55, 170, 690, 24);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("PHẦN I: THÍ SINH TRẢ LỜI TỪ CÂU 1 ĐẾN CÂU 40 (TÔ ĐẬM 1 Ô TRÒN DUY NHẤT)", 65, 186);

    // Vẽ lưới ô tròn mờ của 40 câu
    for (let q = 1; q <= 40; q++) {
      const isCol1 = q <= 20;
      const colStartX = isCol1 ? 60 : 410;
      const rowIdx = isCol1 ? (q - 1) : (q - 21);
      const cy = 220 + rowIdx * 21;

      ctx.fillStyle = "#475569";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText((q < 10 ? "0" + q : q) + ".", colStartX, cy + 4);

      const opts = ['A', 'B', 'C', 'D'];
      opts.forEach((opt, oIdx) => {
        const cx = colStartX + 52 + oIdx * 28;
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#64748b";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(opt, cx, cy + 3);
      });
    }

    // Tiêu đề PHẦN II
    ctx.fillStyle = "#064e3b";
    ctx.fillRect(55, 642, 340, 22);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10.5px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("PHẦN II: CÂU HỎI ĐÚNG / SAI (8 CÂU)", 65, 657);

    // Vẽ ô tròn trống phần II
    for (let c = 1; c <= 8; c++) {
      const cy = 670 + (c - 1) * 24;
      ctx.fillStyle = "#334155";
      ctx.font = "bold 10.5px sans-serif";
      ctx.fillText("Câu " + c + ":", 60, cy + 4);

      ['a', 'b', 'c', 'd'].forEach((sub, sIdx) => {
        const subX = 60 + 70 + sIdx * 45;
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(subX, cy, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#64748b";
        ctx.font = "8.5px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(sub, subX, cy + 3);
      });
    }

    // Tiêu đề PHẦN III
    ctx.fillStyle = "#78350f";
    ctx.fillRect(410, 885, 335, 22);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10.5px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("PHẦN III: TRẢ LỜI NGẮN (6 CÂU)", 420, 900);

    // Vẽ dòng điền số phần III
    for (let c = 1; c <= 6; c++) {
      const cy = 915 + (c - 1) * 26;
      ctx.fillStyle = "#334155";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("Câu " + c + ":", 420, cy + 4);

      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(485, cy - 10, 60, 20);
    }

    const result = await window.omrEngine.processSheetCanvas(
      canvas,
      this.state.activeExamKeys,
      this.state.studentList,
      this.state.gradingRules
    );

    await this.addGradedSubmission(result);
    this.renderRecentScanTable();
    this.showToast(`Đã chấm xong! SBD: ${result.sbd} - ${result.totalScore}đ. Đang mở bài để xem lại...`, "success");
    // Mở ngay cửa sổ xem bài trực quan cho giáo viên thấy!
    this.openReviewModal(result.id);
  }

  async addGradedSubmission(item) {
    // 1. Kiểm tra xem bài thi này có đang được chấm lại theo đúng ID không
    const existingByIdx = this.state.gradedList.findIndex(s => s.id === item.id);
    if (existingByIdx !== -1) {
      this.state.gradedList[existingByIdx] = item;
      await this.saveState();
      this.renderRecentScanTable();
      this.renderGradedTable();
      this.updateStatsBar();
      this.updateClassBreakdown();
      return;
    }

    // 2. Tuyệt đối KHÔNG ghi đè khi SBD rỗng, SBD thiếu hoặc SBD lỗi
    // (Mỗi ảnh bài thi là của 1 học sinh riêng biệt cần bảo toàn đầy đủ số lượng bài)
    const rawSbd = String(item.sbd || '').trim();
    const isValidSbd = rawSbd && rawSbd !== '________' && rawSbd !== '00000000' && !rawSbd.includes('_') && !rawSbd.includes('X');

    // 3. Nếu SBD hợp lệ và trùng với bài đã có trong danh sách:
    // Cả hai bài đều được giữ nguyên vẹn để giáo viên xem lại, gắn thêm lưu ý Trùng SBD
    if (isValidSbd) {
      const dupIdx = this.state.gradedList.findIndex(s => String(s.sbd).trim() === rawSbd);
      if (dupIdx !== -1) {
        const oldItem = this.state.gradedList[dupIdx];
        if (!oldItem.notes || !oldItem.notes.includes('Trùng SBD')) {
          oldItem.notes = oldItem.notes ? `${oldItem.notes}; ⚠️ Trùng SBD với bài khác` : '⚠️ Trùng SBD với bài khác';
        }
        item.notes = item.notes ? `${item.notes}; ⚠️ Trùng SBD với bài khác` : '⚠️ Trùng SBD với bài khác';
      }
    }

    // Thêm bài thi vào danh sách
    this.state.gradedList.unshift(item);
    await this.saveState();
    this.renderRecentScanTable();
    this.renderGradedTable();
    this.updateStatsBar();
    this.updateClassBreakdown();
  }

  // Camera handling
  async toggleCamera() {
    if (this.state.cameraStream) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  async startCamera() {
    const video = document.getElementById('cameraVideo');
    const btn = document.getElementById('btnToggleCamera');
    const statusText = document.getElementById('cameraStatusText');

    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.state.cameraStream = stream;
      video.srcObject = stream;
      await video.play();

      if (btn) {
        btn.textContent = "🛑 Tắt Camera";
        btn.className = "btn btn-danger";
      }
      if (statusText) statusText.textContent = "Camera đang hoạt động (Đưa bài thi vào khung)";

      this.showToast("Camera đã bật!", "success");
    } catch (err) {
      console.error(err);
      this.showToast("Không thể mở camera: " + err.message, "danger");
    }
  }

  stopCamera() {
    if (this.state.cameraStream) {
      this.state.cameraStream.getTracks().forEach(t => t.stop());
      this.state.cameraStream = null;
    }
    const video = document.getElementById('cameraVideo');
    if (video) video.srcObject = null;

    const btn = document.getElementById('btnToggleCamera');
    if (btn) {
      btn.textContent = "📷 Bật Camera";
      btn.className = "btn btn-primary";
    }
    const statusText = document.getElementById('cameraStatusText');
    if (statusText) statusText.textContent = "Camera đang tắt";
  }

  async captureCurrentFrame() {
    const video = document.getElementById('cameraVideo');
    if (!this.state.cameraStream || !video.videoWidth) {
      this.showToast("Vui lòng bật camera trước khi chụp!", "warning");
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    const result = await window.omrEngine.processSheetCanvas(
      canvas,
      this.state.activeExamKeys,
      this.state.studentList,
      this.state.gradingRules
    );

    this.addGradedSubmission(result);
    this.showToast(`Đã chụp & chấm: SBD ${result.sbd} - ${result.totalScore}đ`, "success");
  }

  // Re-grade all submissions
  regradeAllSubmissions() {
    if (this.state.gradedList.length === 0) {
      this.showToast("Chưa có bài nào để chấm lại!", "warning");
      return;
    }

    let updatedCount = 0;
    this.state.gradedList.forEach(item => {
      if (item.scannedData) {
        const key = this.state.activeExamKeys[item.scannedData.examCode];
        const newGrade = window.omrEngine.calculateGrade(item.scannedData, key, this.state.gradingRules);
        item.p1Score = newGrade.p1Score;
        item.p2Score = newGrade.p2Score;
        item.p3Score = newGrade.p3Score;
        item.totalScore = newGrade.totalScore;
        item.notes = newGrade.notes;
        item.details = newGrade.details;
        updatedCount++;
      }
    });

    this.renderGradedTable();
    this.updateStatsBar();
    this.showToast(`Đã chấm lại ${updatedCount} bài thi theo đáp án mới!`, "success");
  }

  // Render UI
  renderMetaInputs() {
    const container = document.getElementById('metaInputsContainer');
    if (!container) return;

    const meta = this.state.examMeta;
    const curYear = new Date().getFullYear();
    if (!meta.schoolYear) {
      meta.schoolYear = `${curYear - 1}-${curYear}`;
    }

    container.innerHTML = `
      <div class="grid-3" style="margin-bottom:12px;">
        <div class="meta-input-group school-input-highlight">
          <label>🏫 Tên trường:</label>
          <input type="text" id="metaSchool" value="${meta.school}" style="font-weight:700; color:#1e1b4b;" title="Bấm vào để điều chỉnh tên trường">
          <div class="school-edit-hint">✏️ Giáo viên có thể tự sửa tên trường tại đây</div>
        </div>
        <div class="meta-input-group">
          <label>🎓 Khối lớp:</label>
          <input type="text" id="metaGrade" value="${meta.grade}" style="font-weight:600;">
        </div>
        <div class="meta-input-group">
          <label>🏷️ Lớp học:</label>
          <input type="text" id="metaClass" value="${meta.className}" style="font-weight:600;">
        </div>
      </div>
      <div class="grid-4" style="display:grid; grid-template-columns: 1fr 1.2fr 1fr 1fr; gap:12px;">
        <div class="meta-input-group">
          <label>📚 Môn thi:</label>
          <input type="text" id="metaSubject" value="${meta.subject}" style="font-weight:700; color:var(--primary);">
        </div>
        <div class="meta-input-group">
          <label>📝 Tên kỳ thi:</label>
          <input type="text" id="metaExamName" value="${meta.examName}">
        </div>
        <div class="meta-input-group">
          <label>📅 Năm học:</label>
          <input type="text" id="metaSchoolYear" value="${meta.schoolYear}" placeholder="2024-2025" style="font-weight:600; color:#1e1b4b;" title="Năm học (dùng đặt tên file và in bảng điểm)">
        </div>
        <div class="meta-input-group">
          <label>📅 Ngày thi:</label>
          <input type="date" id="metaExamDate" value="${meta.examDate}">
        </div>
      </div>
    `;

    // Bind change
    ['metaSchool', 'metaGrade', 'metaClass', 'metaSubject', 'metaExamName', 'metaSchoolYear', 'metaExamDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          this.state.examMeta.school = document.getElementById('metaSchool').value;
          this.state.examMeta.grade = document.getElementById('metaGrade').value;
          this.state.examMeta.className = document.getElementById('metaClass').value;
          this.state.examMeta.subject = document.getElementById('metaSubject').value;
          this.state.examMeta.examName = document.getElementById('metaExamName').value;
          this.state.examMeta.schoolYear = document.getElementById('metaSchoolYear').value;
          this.state.examMeta.examDate = document.getElementById('metaExamDate').value;
          this.saveState();
        });
      }
    });
  }

  renderGradingInputs() {
    const container = document.getElementById('gradingRulesContainer');
    if (!container) return;

    const r = this.state.gradingRules;
    const isStandard = (r.p2.mode !== 'per_item');

    container.innerHTML = `
      <div class="grid-3">
        <!-- Phần I -->
        <div class="scoring-card card-p1">
          <div>
            <div class="card-part-header" style="border-bottom-color:#e0e7ff;">
              <span class="part-tag-icon" style="background:#e0e7ff; color:#4338ca">🎯</span>
              <span style="font-weight:700; color:#312e81;">Phần I: TN 4 Lựa chọn</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:14px; white-space:nowrap; flex-wrap:nowrap;">
              <label style="font-weight:600; font-size:0.88rem; color:#334155; margin:0; flex-shrink:0;">Số điểm mỗi câu đúng:</label>
              <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                <input type="number" step="0.05" class="form-control" id="ruleP1Point" value="${r.p1.pointPerQuestion}" style="width:75px; text-align:center; font-weight:700; padding:6px 6px; margin:0;">
                <span style="font-size:0.85rem; font-weight:600; color:#475569; white-space:nowrap;">điểm/câu</span>
              </div>
            </div>
          </div>
          <div style="background:#f5f3ff; border:1px solid #ddd6fe; border-radius:8px; padding:8px 10px; margin-top:14px;">
            <p class="dropzone-hint" style="color:#5b21b6; margin:0; font-weight:500;">
              💡 12 câu x 0.25đ = 3.0đ | 40 câu x 0.25đ = 10.0đ
            </p>
          </div>
        </div>

        <!-- Phần II -->
        <div class="scoring-card card-p2">
          <div>
            <div class="card-part-header" style="border-bottom-color:#d1fae5;">
              <span class="part-tag-icon" style="background:#d1fae5; color:#065f46">⚖️</span>
              <span style="font-weight:700; color:#065f46;">Phần II: Đúng / Sai</span>
            </div>
            
            <div style="margin-top:10px;">
              <!-- Lựa chọn 1: Thang chuẩn Bộ -->
              <label class="radio-card ${isStandard ? 'selected' : ''}">
                <input type="radio" name="p2ScoringMode" value="standard" ${isStandard ? 'checked' : ''} style="margin-top:4px;">
                <div style="flex:1;">
                  <strong style="color:${isStandard ? '#065f46' : '#1e293b'}; font-size:0.88rem;">Thang điểm chuẩn Bộ GD&ĐT (Lũy tiến)</strong>
                  <div class="scoring-ladder">
                    <span class="ladder-pill">1 ý: <b>0.1đ</b></span>
                    <span class="ladder-pill">2 ý: <b>0.25đ</b></span>
                    <span class="ladder-pill">3 ý: <b>0.5đ</b></span>
                    <span class="ladder-pill ladder-full">4 ý: <b>1.0đ</b></span>
                  </div>
                </div>
              </label>

              <!-- Lựa chọn 2: Giáo viên tự nhập -->
              <label class="radio-card ${!isStandard ? 'selected' : ''}">
                <input type="radio" name="p2ScoringMode" value="per_item" ${!isStandard ? 'checked' : ''} style="margin-top:4px;">
                <div style="flex:1;">
                  <strong style="color:${!isStandard ? '#065f46' : '#1e293b'}; font-size:0.88rem;">Số điểm mỗi ý đúng (Tự nhập)</strong>
                  <div style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:6px; white-space:nowrap; flex-wrap:nowrap;">
                    <span style="font-size:0.85rem; font-weight:600; color:#475569; flex-shrink:0;">Số điểm mỗi ý đúng:</span>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                      <input type="number" step="0.05" class="form-control" id="ruleP2PointPerItem" value="${r.p2.pointPerItem || 0.25}" style="width:75px; text-align:center; font-weight:700; padding:4px 6px; margin:0; font-size:0.9rem;">
                      <span style="font-size:0.85rem; font-weight:600; color:#475569; white-space:nowrap;">điểm/ý</span>
                    </div>
                  </div>
                </div>
              </label>
            </div>
          </div>
          <div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; padding:8px 10px; margin-top:8px;">
            <p class="dropzone-hint" style="color:#047857; margin:0; font-weight:500;">
              ✨ Phù hợp cả đề thi 4 câu hoặc 8 câu Đúng/Sai
            </p>
          </div>
        </div>

        <!-- Phần III -->
        <div class="scoring-card card-p3">
          <div>
            <div class="card-part-header" style="border-bottom-color:#fef3c7;">
              <span class="part-tag-icon" style="background:#fef3c7; color:#92400e">✍️</span>
              <span style="font-weight:700; color:#92400e;">Phần III: Trả lời ngắn</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:14px; white-space:nowrap; flex-wrap:nowrap;">
              <label style="font-weight:600; font-size:0.88rem; color:#334155; margin:0; flex-shrink:0;">Số điểm mỗi câu đúng:</label>
              <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                <input type="number" step="0.05" class="form-control" id="ruleP3Point" value="${r.p3.pointPerQuestion}" style="width:75px; text-align:center; font-weight:700; padding:6px 6px; margin:0;">
                <span style="font-size:0.85rem; font-weight:600; color:#475569; white-space:nowrap;">điểm/câu</span>
              </div>
            </div>
          </div>
          <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:8px 10px; margin-top:14px;">
            <p class="dropzone-hint" style="color:#b45309; margin:0; font-weight:500;">
              💡 6 câu x 0.5đ = 3.0đ | hoặc tự đặt 0.25đ/câu
            </p>
          </div>
        </div>
      </div>
    `;

    // Bindings
    const p1Input = document.getElementById('ruleP1Point');
    if (p1Input) {
      p1Input.addEventListener('input', () => {
        this.state.gradingRules.p1.pointPerQuestion = parseFloat(p1Input.value) || 0.25;
        this.saveState();
      });
    }

    const p3Input = document.getElementById('ruleP3Point');
    if (p3Input) {
      p3Input.addEventListener('input', () => {
        this.state.gradingRules.p3.pointPerQuestion = parseFloat(p3Input.value) || 0.5;
        this.saveState();
      });
    }

    const p2PerItemInput = document.getElementById('ruleP2PointPerItem');
    if (p2PerItemInput) {
      p2PerItemInput.addEventListener('input', () => {
        this.state.gradingRules.p2.pointPerItem = parseFloat(p2PerItemInput.value) || 0.25;
        this.saveState();
      });
    }

    document.querySelectorAll('input[name="p2ScoringMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.state.gradingRules.p2.mode = e.target.value;
        this.saveState();
        this.renderGradingInputs();
      });
    });
  }

  // --- TRÌNH NHẬP & CHỈNH SỬA ĐÁP ÁN TRỰC TIẾP ---
  renderAnswerKeyEditor() {
    const tabsBar = document.getElementById('codeTabsBar');
    const editor = document.getElementById('interactiveAnswerEditor');
    if (!tabsBar || !editor) return;

    const codes = Object.keys(this.state.activeExamKeys);
    if (codes.length === 0) {
      tabsBar.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem">Chưa có mã đề nào. Hãy bấm "➕ Thêm Mã Đề" để tạo.</span>`;
      editor.innerHTML = `<p style="text-align:center; padding:30px; color:var(--text-muted);">Vui lòng thêm mã đề hoặc nạp file Excel đáp án.</p>`;
      return;
    }

    // Chọn mã đề hợp lệ
    if (!this.state.selectedExamCode || !this.state.activeExamKeys[this.state.selectedExamCode]) {
      this.state.selectedExamCode = codes[0];
    }

    const curCode = this.state.selectedExamCode;
    const curKey = this.state.activeExamKeys[curCode] || { p1: {}, p2: {}, p3: {} };

    // 1. Render các tab mã đề
    tabsBar.innerHTML = codes.map(code => `
      <button class="code-tab-btn ${code === curCode ? 'active' : ''}" onclick="window.app.selectExamCode('${code}')">
        Mã đề: ${code}
      </button>
    `).join('');

    // Lấy chính xác danh sách câu hỏi đã sắp xếp cho từng phần
    const p1Keys = Object.keys(curKey.p1 || {}).map(Number).sort((a, b) => a - b);
    const p2Keys = Object.keys(curKey.p2 || {}).map(Number).sort((a, b) => a - b);
    const p3Keys = Object.keys(curKey.p3 || {}).map(Number).sort((a, b) => a - b);

    let html = `
      <!-- Khung cấu hình số lượng câu hỏi -->
      <div class="card" style="background:#f1f5f9; border:1.5px dashed #cbd5e1; padding:12px 16px; margin-bottom:16px;">
        <div style="font-weight:700; font-size:0.88rem; color:#1e293b; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
          <span>⚙️ Cấu Hình Số Câu Của Đề Thi (Dành Cho Nhập Trực Tiếp)</span>
          <span style="font-size:0.75rem; color:var(--text-muted)">Tổng: <strong>${p1Keys.length + p2Keys.length + p3Keys.length} câu</strong></span>
        </div>
        <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
          <div>
            <span style="font-size:0.82rem; font-weight:600">Phần I (TN4LC):</span>
            <input type="number" id="cfgP1Count" value="${p1Keys.length || 12}" min="0" max="40" class="form-control" style="width:70px; display:inline-block; padding:4px 8px; font-weight:700;"> câu
          </div>
          <div>
            <span style="font-size:0.82rem; font-weight:600">Phần II (Đúng/Sai):</span>
            <input type="number" id="cfgP2Count" value="${p2Keys.length || 4}" min="0" max="8" class="form-control" style="width:70px; display:inline-block; padding:4px 8px; font-weight:700;"> câu
          </div>
          <div>
            <span style="font-size:0.82rem; font-weight:600">Phần III (TLN):</span>
            <input type="number" id="cfgP3Count" value="${p3Keys.length || 6}" min="0" max="6" class="form-control" style="width:70px; display:inline-block; padding:4px 8px; font-weight:700;"> câu
          </div>
          <button class="btn btn-primary btn-sm" onclick="window.app.applyExamStructure()">Áp Dụng Số Câu</button>
        </div>
      </div>

      <!-- PHẦN I: Trắc nghiệm 4 lựa chọn -->
      <div style="margin-bottom:18px;">
        <div style="font-weight:700; color:var(--primary); margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
          <span>Phần I: Trắc nghiệm 4 lựa chọn (${p1Keys.length} câu)</span>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal">
            💡 Có thể chọn <strong>nhiều đáp án đúng</strong> (bấm chọn thêm) hoặc <strong>★</strong> để tặng điểm
          </span>
        </div>
        <div class="ans-matrix-grid">
    `;

    p1Keys.forEach(q => {
      const currentAns = (curKey.p1 && curKey.p1[q]) ? String(curKey.p1[q]).trim().toUpperCase() : "";
      const selectedOpts = currentAns === "*" ? ["*"] : currentAns.split(/[,/]/).map(s => s.trim().toUpperCase()).filter(Boolean);
      const isMulti = selectedOpts.length > 1;

      html += `
        <div class="ans-row-card" style="${isMulti ? 'border-color:var(--primary); background:#f5f3ff;' : ''}">
          <div style="display:flex; flex-direction:column;">
            <span class="ans-row-label">Câu ${q}:</span>
            ${isMulti ? `<span style="font-size:0.68rem; color:var(--primary); font-weight:700;">(${currentAns})</span>` : ''}
          </div>
          <div style="display:flex; gap:4px; align-items:center;">
            ${['A', 'B', 'C', 'D'].map(opt => {
        const active = selectedOpts.includes(opt);
        return `
                <button class="opt-pill-btn ${active ? 'active' : ''}" 
                        title="${active ? 'Bấm để bỏ chọn' : 'Bấm để chọn đáp án này'}"
                        onclick="window.app.setPart1Answer('${curCode}', ${q}, '${opt}')">${opt}</button>
              `;
      }).join('')}
            <button class="opt-pill-btn ${selectedOpts.includes('*') ? 'active' : ''}" 
                    style="border-color:#f59e0b; color:${selectedOpts.includes('*') ? '#fff' : '#d97706'}; background:${selectedOpts.includes('*') ? '#f59e0b' : '#fff'}" 
                    title="Tặng điểm câu này (Tất cả học sinh đều được điểm)" 
                    onclick="window.app.setPart1Answer('${curCode}', ${q}, '*')">★</button>
          </div>
        </div>
      `;
    });
    html += `</div></div>`;

    // PHẦN II: Đúng / Sai
    html += `
      <div style="margin-bottom:18px;">
        <div style="font-weight:700; color:var(--primary); margin-bottom:8px;">
          Phần II: Đúng / Sai (${p2Keys.length} câu - mỗi câu gồm 4 ý a, b, c, d)
        </div>
        <div class="grid-2">
    `;

    p2Keys.forEach((q, idx) => {
      const rawAns = (curKey.p2 && curKey.p2[q]) ? String(curKey.p2[q]).toUpperCase() : "D-D-S-D";
      const parts = rawAns.replace(/[^DS]/g, '').split('');
      while (parts.length < 4) parts.push('D');

      html += `
        <div class="ans-row-card" style="flex-direction:column; align-items:flex-start; padding:10px 14px;">
          <div style="font-weight:700; margin-bottom:6px; font-size:0.85rem; color:#334155;">
            Câu ${q}:
          </div>
          <div style="display:flex; justify-content:space-between; width:100%;">
            ${['a', 'b', 'c', 'd'].map((item, itemIdx) => {
        const val = parts[itemIdx] || 'D';
        return `
                <div class="tf-item">
                  <strong>${item})</strong>
                  <button class="tf-btn ${val === 'D' ? 'active-d' : ''}" 
                          onclick="window.app.setPart2Answer('${curCode}', ${q}, ${itemIdx}, 'D')">Đ</button>
                  <button class="tf-btn ${val === 'S' ? 'active-s' : ''}" 
                          onclick="window.app.setPart2Answer('${curCode}', ${q}, ${itemIdx}, 'S')">S</button>
                </div>
              `;
      }).join('')}
          </div>
        </div>
      `;
    });
    html += `</div></div>`;

    // PHẦN III: Trả lời ngắn
    html += `
      <div>
        <div style="font-weight:700; color:var(--primary); margin-bottom:8px;">
          Phần III: Trả lời ngắn (${p3Keys.length} câu)
        </div>
        <div class="grid-3">
    `;

    p3Keys.forEach((q, idx) => {
      const val = (curKey.p3 && curKey.p3[q]) !== undefined ? String(curKey.p3[q]) : "";
      html += `
        <div class="ans-row-card">
          <span class="ans-row-label">Câu ${q}:</span>
          <input type="text" class="form-control" style="padding:4px 8px; font-size:0.85rem; max-width:120px;" 
                 placeholder="VD: 1.5 hoặc -0,5" value="${val}" 
                 oninput="window.app.setPart3Answer('${curCode}', ${q}, this.value)"
                 onchange="window.app.setPart3Answer('${curCode}', ${q}, this.value)">
        </div>
      `;
    });
    html += `</div></div>`;

    editor.innerHTML = html;
  }

  // Cập nhật cấu trúc số câu cho các phần (Áp dụng cho tất cả mã đề đang có)
  applyExamStructure() {
    const n1 = parseInt(document.getElementById('cfgP1Count').value, 10) || 12;
    const n2 = parseInt(document.getElementById('cfgP2Count').value, 10) || 4;
    const n3 = parseInt(document.getElementById('cfgP3Count').value, 10) || 6;

    const codes = Object.keys(this.state.activeExamKeys);
    if (codes.length === 0) {
      this.state.activeExamKeys["1201"] = { p1: {}, p2: {}, p3: {} };
      codes.push("1201");
    }

    codes.forEach(code => {
      const cur = this.state.activeExamKeys[code] || { p1: {}, p2: {}, p3: {} };
      const newP1 = {}, newP2 = {}, newP3 = {};

      // 1. Phần I: 1 -> n1
      for (let q = 1; q <= n1; q++) {
        newP1[q] = cur.p1 && cur.p1[q] ? cur.p1[q] : (['A', 'B', 'C', 'D'][(q - 1) % 4]);
      }

      // 2. Phần II: 1 -> n2 (Chuẩn theo mẫu phiếu trắc nghiệm)
      let oldP2Values = Object.values(cur.p2 || {});
      for (let i = 0; i < n2; i++) {
        const q = i + 1;
        newP2[q] = oldP2Values[i] || "D-D-S-D";
      }

      // 3. Phần III: 1 -> n3 (Chuẩn theo mẫu phiếu trắc nghiệm)
      let oldP3Values = Object.values(cur.p3 || {});
      for (let i = 0; i < n3; i++) {
        const q = i + 1;
        newP3[q] = oldP3Values[i] || "0";
      }

      this.state.activeExamKeys[code] = { p1: newP1, p2: newP2, p3: newP3 };
    });

    if (this.state.answerSource !== 'direct') {
      this.state.answerSource = 'direct';
      this.updateSourceUI();
    }
    this.saveState();
    this.renderAnswerKeyEditor();
    this.showToast(`Đã áp dụng cấu trúc đề: ${n1} câu TN, ${n2} câu Đúng/Sai, ${n3} câu TLN (Chế độ Nhập trực tiếp)!`, "success");
  }

  selectExamCode(code) {
    this.state.selectedExamCode = code;
    this.renderAnswerKeyEditor();
  }

  // Chọn hoặc bật/tắt đáp án Phần I (Hỗ trợ nhiều đáp án đúng hoặc *)
  setPart1Answer(code, q, opt) {
    if (!this.state.activeExamKeys[code]) return;
    if (!this.state.activeExamKeys[code].p1) this.state.activeExamKeys[code].p1 = {};

    const cur = (this.state.activeExamKeys[code].p1[q] || "").trim().toUpperCase();

    if (opt === '*') {
      // Tặng điểm
      this.state.activeExamKeys[code].p1[q] = (cur === '*') ? "" : "*";
    } else {
      // Bấm chọn A, B, C, D
      let parts = (cur === '*' ? [] : cur.split(/[,/]/).map(s => s.trim().toUpperCase()).filter(Boolean));
      if (parts.includes(opt)) {
        // Đã có -> Bỏ chọn
        parts = parts.filter(p => p !== opt);
      } else {
        // Chưa có -> Thêm vào (chấp nhận nhiều đáp án đúng)
        parts.push(opt);
        parts.sort();
      }
      this.state.activeExamKeys[code].p1[q] = parts.join(', ');
    }

    if (this.state.answerSource !== 'direct') {
      this.state.answerSource = 'direct';
      this.updateSourceUI();
    }
    this.saveState();
    this.renderAnswerKeyEditor();
  }

  // Sửa đúng/sai Phần II (Đổi chính xác câu q đang chọn, KHÔNG sinh câu mới)
  setPart2Answer(code, q, itemIdx, opt) {
    if (!this.state.activeExamKeys[code]) return;
    if (!this.state.activeExamKeys[code].p2) this.state.activeExamKeys[code].p2 = {};

    const raw = String(this.state.activeExamKeys[code].p2[q] || "D-D-D-D");
    const parts = raw.replace(/[^DS]/g, '').split('');
    while (parts.length < 4) parts.push('D');
    parts[itemIdx] = opt;
    this.state.activeExamKeys[code].p2[q] = parts.join('-');

    if (this.state.answerSource !== 'direct') {
      this.state.answerSource = 'direct';
      this.updateSourceUI();
    }
    this.saveState();
    this.renderAnswerKeyEditor();
  }

  // Sửa kết quả trả lời ngắn Phần III
  setPart3Answer(code, q, val) {
    if (!this.state.activeExamKeys[code]) return;
    if (!this.state.activeExamKeys[code].p3) this.state.activeExamKeys[code].p3 = {};
    this.state.activeExamKeys[code].p3[q] = String(val).trim();
    if (this.state.answerSource !== 'direct') {
      this.state.answerSource = 'direct';
      this.updateSourceUI();
    }
    this.saveState();
  }

  promptAddNewExamCode() {
    const code = prompt("Nhập mã đề mới (ví dụ: 1203, 1204, 703...):", "");
    if (!code || !code.trim()) return;
    const cleanCode = code.trim();
    if (this.state.activeExamKeys[cleanCode]) {
      this.showToast(`Mã đề ${cleanCode} đã tồn tại!`, "warning");
      this.selectExamCode(cleanCode);
      return;
    }

    // Sao chép cấu trúc từ mã đề đang chọn nếu có
    const baseCode = this.state.selectedExamCode;
    const baseData = this.state.activeExamKeys[baseCode];
    if (baseData) {
      this.state.activeExamKeys[cleanCode] = JSON.parse(JSON.stringify(baseData));
    } else {
      this.state.activeExamKeys[cleanCode] = {
        p1: { 1: "A", 2: "B", 3: "C", 4: "D", 5: "A", 6: "B", 7: "C", 8: "D", 9: "A", 10: "B", 11: "C", 12: "D", 13: "A", 14: "B", 15: "C", 16: "D" },
        p2: { 1: "D-D-S-D", 2: "D-S-D-S", 3: "D-D-S-D", 4: "S-D-D-D" },
        p3: { 1: "1,5", 2: "4,6", 3: "3,5", 4: "32,7" }
      };
    }

    this.state.selectedExamCode = cleanCode;
    if (this.state.answerSource !== 'direct') {
      this.state.answerSource = 'direct';
      this.updateSourceUI();
    }
    this.saveState();
    this.renderAnswerKeyEditor();
    this.showToast(`Đã thêm mã đề ${cleanCode}! Bạn có thể chỉnh sửa đáp án ngay bên dưới.`, "success");
  }

  deleteCurrentExamCode() {
    const cur = this.state.selectedExamCode;
    if (!cur) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa mã đề ${cur}?`)) return;

    delete this.state.activeExamKeys[cur];
    const remaining = Object.keys(this.state.activeExamKeys);
    this.state.selectedExamCode = remaining.length > 0 ? remaining[0] : "";
    if (this.state.answerSource !== 'direct') {
      this.state.answerSource = 'direct';
      this.updateSourceUI();
    }
    this.saveState();
    this.renderAnswerKeyEditor();
    this.showToast(`Đã xóa mã đề ${cur}!`, "info");
  }

  exportAnswerKeyExcel() {
    const codes = Object.keys(this.state.activeExamKeys);
    if (codes.length === 0) {
      this.showToast("Chưa có mã đề nào để xuất!", "warning");
      return;
    }

    const config = codes.map(code => {
      const data = this.state.activeExamKeys[code];
      const items = [];
      // Phần I
      Object.keys(data.p1 || {}).map(Number).sort((a, b) => a - b).forEach(q => {
        items.push({ stt: q, type: "TN4 lựa chọn", ans: data.p1[q] });
      });
      // Phần II
      Object.keys(data.p2 || {}).map(Number).sort((a, b) => a - b).forEach(q => {
        items.push({ stt: q, type: "Đúng sai", ans: data.p2[q], note: "Nhập: D-S-D-S" });
      });
      // Phần III
      Object.keys(data.p3 || {}).map(Number).sort((a, b) => a - b).forEach(q => {
        items.push({ stt: q, type: "Trả lời ngắn", ans: data.p3[q], note: "Tối đa 4 ký tự" });
      });
      return { code, items };
    });

    const wb = window.excelHandler.generateAnswerKeyWorkbook(config);
    XLSX.writeFile(wb, "MAU_DAP_AN_TAO_TU_APP.xlsx");
    this.showToast("Đã xuất tệp MAU_DAP_AN_TAO_TU_APP.xlsx thành công!", "success");
  }

  downloadSampleStudentExcel() {
    if (!window.XLSX) {
      this.showToast("Thư viện Excel chưa sẵn sàng!", "warning");
      return;
    }
    const headers = ["STT", "Số báo danh", "Họ và tên học sinh", "Lớp"];
    const rows = [
      headers,
      [1, "12000001", "Nguyễn Lê Dân An", "12A"],
      [2, "12000002", "Cao Minh Anh", "12A"],
      [3, "12000003", "Nguyễn Phạm Quỳnh Anh", "12A"],
      [4, "12000004", "Nguyễn Hoàng Bách", "12A"],
      [5, "12000005", "Nguyễn Khánh Băng", "12A"],
      [6, "12000006", "Nguyễn Ngọc Bảo Châu", "12A"],
      [7, "12000007", "Trần Phú Cường", "12A"],
      [8, "12000008", "Trương Thanh Duy", "12A"],
      [9, "12000009", "Nguyễn Tấn Đạt", "12A"],
      [10, "12000010", "Trần Thị Ngọc Giàu", "12A"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 28 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DANH SACH HỌC SINH");
    XLSX.writeFile(wb, "DANH_SACH_HOC_SINH_MAU.xlsx");
    this.showToast("Đã tải xuống tệp DANH_SACH_HOC_SINH_MAU.xlsx!", "success");
  }

  restoreSampleStudents() {
    this.state.studentList = [
      { sbd: "12000001", name: "Nguyễn Lê Dân An", className: "12A" },
      { sbd: "12000002", name: "Cao Minh Anh", className: "12A" },
      { sbd: "12000003", name: "Nguyễn Phạm Quỳnh Anh", className: "12A" },
      { sbd: "12000004", name: "Nguyễn Hoàng Bách", className: "12A" },
      { sbd: "12000005", name: "Nguyễn Khánh Băng", className: "12A" },
      { sbd: "12000006", name: "Nguyễn Ngọc Bảo Châu", className: "12A" },
      { sbd: "12000007", name: "Trần Phú Cường", className: "12A" },
      { sbd: "12000008", name: "Trương Thanh Duy", className: "12A" },
      { sbd: "12000009", name: "Nguyễn Tấn Đạt", className: "12A" },
      { sbd: "12000010", name: "Trần Thị Ngọc Giàu", className: "12A" }
    ];
    this.renderStudentListTable();
    this.showToast("Đã nạp 10 học sinh mẫu chuẩn SBD 8 số!", "success");
  }

  filterStudentList(query) {
    this.state.studentSearchQuery = query;
    this.renderStudentListTable();
  }

  renderStudentListTable() {
    const container = document.getElementById('studentTableContainer');
    if (!container) return;

    const list = this.state.studentList;
    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-student-state" id="emptyStudentDropzone" style="cursor:pointer;" onclick="document.getElementById('studentFileInput').click()">
          <div style="font-size:52px; margin-bottom:12px;">👥</div>
          <h4 style="font-size:1.2rem; color:#1e1b4b; font-weight:800; margin-bottom:8px;">Danh Sách Học Sinh Đang Trống</h4>
          <p style="font-size:0.88rem; color:#64748b; max-width:520px; margin:0 auto 18px; line-height:1.5;">
            Bấm vào đây để <strong>Đính kèm tệp danh sách học sinh (.xlsx)</strong> hoặc kéo thả tệp Excel vào khung này để nạp danh sách vào hệ thống.
          </p>
          <div style="display:flex; justify-content:center; gap:12px; flex-wrap:wrap;" onclick="event.stopPropagation()">
            <button class="btn btn-primary" style="font-weight:700; padding:10px 20px; box-shadow:0 4px 12px rgba(79, 70, 229, 0.3);" onclick="document.getElementById('studentFileInput').click()">
              📁 Đính Kèm Tệp Danh Sách (.xlsx)
            </button>
            <button class="btn btn-outline" onclick="window.app.downloadSampleStudentExcel()">
              📥 Tải File Excel Mẫu
            </button>
          </div>
        </div>
      `;

      const dz = document.getElementById('emptyStudentDropzone');
      if (dz) {
        dz.ondragover = (e) => { e.preventDefault(); dz.style.borderColor = '#4f46e5'; dz.style.background = '#f5f3ff'; };
        dz.ondragleave = (e) => { e.preventDefault(); dz.style.borderColor = '#cbd5e1'; dz.style.background = '#f8fafc'; };
        dz.ondrop = (e) => {
          e.preventDefault();
          dz.style.borderColor = '#cbd5e1';
          dz.style.background = '#f8fafc';
          if (e.dataTransfer.files.length > 0) {
            this.handleStudentFileUpload(e.dataTransfer.files[0]);
          }
        };
      }
      return;
    }

    const uniqueClasses = [...new Set(list.map(s => s.className).filter(Boolean))];
    const query = (this.state.studentSearchQuery || "").toLowerCase().trim();
    const filtered = query
      ? list.filter(st => st.name.toLowerCase().includes(query) || String(st.sbd).includes(query) || (st.className && st.className.toLowerCase().includes(query)))
      : list;

    const avatarColors = [
      'linear-gradient(135deg, #4f46e5, #6366f1)',
      'linear-gradient(135deg, #0ea5e9, #38bdf8)',
      'linear-gradient(135deg, #10b981, #34d399)',
      'linear-gradient(135deg, #f59e0b, #fbbf24)',
      'linear-gradient(135deg, #ec4899, #f472b6)',
      'linear-gradient(135deg, #8b5cf6, #a78bfa)',
      'linear-gradient(135deg, #059669, #10b981)'
    ];

    const getInitials = (name) => {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
      return (parts[0] ? parts[0].slice(0, 2) : "HS").toUpperCase();
    };

    let html = `
      <!-- Thẻ thống kê danh sách học sinh (Chỉ hiện tổng số danh sách đang nhập) -->
      <div class="stat-summary-bar" style="display:flex; margin-bottom:14px;">
        <div class="stat-card-mini" style="border-left:4px solid #4f46e5; min-width:260px;">
          <div class="stat-mini-icon" style="background:#e0e7ff; color:#4338ca;">👥</div>
          <div class="stat-mini-info">
            <h4 style="font-size:1.6rem; color:#1e1b4b; font-weight:800;">${list.length}</h4>
            <p style="font-weight:700; color:#4f46e5; font-size:0.8rem; letter-spacing:0.5px;">TỔNG SỐ HỌC SINH ĐANG NHẬP</p>
          </div>
        </div>
      </div>

      <!-- Thanh công cụ tìm kiếm và thông tin -->
      <div class="student-toolbar">
        <div class="search-box-container">
          <span class="search-icon">🔍</span>
          <input type="text" placeholder="Tìm kiếm nhanh theo Tên học sinh, Số báo danh hoặc Lớp..." 
                 value="${this.state.studentSearchQuery || ''}" 
                 oninput="window.app.filterStudentList(this.value)">
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.82rem; color:#64748b; font-weight:600;">
            Hiển thị <strong>${filtered.length}</strong> / ${list.length} học sinh
          </span>
          ${this.state.studentSearchQuery ? `<button class="btn btn-outline btn-sm" onclick="window.app.filterStudentList('')">✕ Bỏ lọc</button>` : ''}
        </div>
      </div>

      <!-- Bảng danh sách học sinh hiện đại -->
      <div class="table-container-modern">
        <div style="max-height:540px; overflow-y:auto;">
          <table class="modern-table">
            <thead>
              <tr>
                <th style="width:65px; text-align:center;">STT</th>
                <th style="width:180px;">Số Báo Danh (8 số)</th>
                <th>Họ và Tên Học Sinh</th>
                <th style="width:110px; text-align:center;">Lớp</th>
                <th style="width:170px; text-align:center;">Trạng Thái Liên Kết</th>
              </tr>
            </thead>
            <tbody>
    `;

    if (filtered.length === 0) {
      html += `<tr><td colspan="5" style="text-align:center; padding:30px; color:#64748b;">Không tìm thấy học sinh nào khớp với từ khóa "<b>${query}</b>"</td></tr>`;
    } else {
      filtered.forEach((st, idx) => {
        const initials = getInitials(st.name || "HS");
        const color = avatarColors[idx % avatarColors.length];
        html += `
          <tr>
            <td style="text-align:center; color:#64748b; font-weight:700;">${idx + 1}</td>
            <td>
              <span class="sbd-badge-large">${st.sbd}</span>
            </td>
            <td>
              <div style="display:flex; align-items:center;">
                <span class="avatar-circle" style="background:${color};">${initials}</span>
                <span style="font-weight:700; color:#0f172a; font-size:0.92rem;">${st.name}</span>
              </div>
            </td>
            <td style="text-align:center;">
              <span class="class-pill">${st.className || '12A'}</span>
            </td>
            <td style="text-align:center;">
              <span class="student-status-tag">
                <span>✓</span> Sẵn sàng chấm
              </span>
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
  }

  renderGradedTable() {
    const container = document.getElementById('gradedTableContainer');
    if (!container) return;

    const list = this.state.gradedList;
    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted)">Chưa có bài thi nào được chấm. Hãy bật Camera hoặc tải ảnh để bắt đầu.</div>`;
      return;
    }

    // Sắp xếp theo SBD từ nhỏ đến lớn (các bài SBD hợp lệ lên đầu, bài thiếu SBD xếp sau)
    const sortedList = [...list].sort((a, b) => {
      const sbdA = String(a.sbd || '').trim();
      const sbdB = String(b.sbd || '').trim();
      const numA = parseInt(sbdA.replace(/\D/g, ''), 10);
      const numB = parseInt(sbdB.replace(/\D/g, ''), 10);
      const hasNumA = !isNaN(numA) && sbdA !== '' && !sbdA.includes('_');
      const hasNumB = !isNaN(numB) && sbdB !== '' && !sbdB.includes('_');
      if (hasNumA && !hasNumB) return -1;
      if (!hasNumA && hasNumB) return 1;
      if (hasNumA && hasNumB) {
        if (numA !== numB) return numA - numB;
        return sbdA.localeCompare(sbdB, undefined, { numeric: true });
      }
      return sbdA.localeCompare(sbdB, undefined, { numeric: true });
    });

    let html = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>Số báo danh (↑)</th>
              <th>Họ và tên học sinh</th>
              <th>Lớp</th>
              <th>Mã đề</th>
              <th>Điểm TN4LC</th>
              <th>Điểm đúng - sai</th>
              <th>Điểm TLN</th>
              <th>Tổng điểm</th>
              <th>Lưu ý</th>
              <th style="text-align:center; width:130px;">Thao tác</th>
            </tr>
          </thead>
          <tbody>
    `;

    sortedList.forEach((item, idx) => {
      const scoreClass = item.totalScore >= 8.0 ? 'score-high' : (item.totalScore >= 5.0 ? 'score-mid' : 'score-low');
      const hasMissingSbd = !item.sbd || item.sbd === '00000000' || item.sbd.length < 8;
      const hasInvalidCode = !this.state.activeExamKeys || !this.state.activeExamKeys[item.examCode];

      html += `
        <tr style="cursor:pointer;" onclick="window.app.openReviewModal('${item.id}')">
          <td>${idx + 1}</td>
          <td>
            <strong>${item.sbd}</strong>
            ${hasMissingSbd ? '<span class="badge-tag" style="background:#fef3c7; color:#b45309; font-size:0.68rem; margin-left:3px; padding:1px 5px; border-radius:4px;" title="Số báo danh chưa tô hoặc chưa đủ 8 số">⚠️ Thiếu SBD</span>' : ''}
          </td>
          <td>${item.name || '<span style="color:#94a3b8">--</span>'}</td>
          <td><span class="class-tag-pill" style="font-size:0.75rem;">${item.className || 'Chưa rõ'}</span></td>
          <td>
            <span class="badge-tag" style="background:#e0e7ff; color:#3730a3">${item.examCode}</span>
            ${hasInvalidCode ? '<span class="badge-tag" style="background:#fee2e2; color:#b91c1c; font-size:0.68rem; margin-left:3px; padding:1px 5px; border-radius:4px;" title="Mã đề chưa có đáp án trong hệ thống">⚠️ Chưa có ĐA</span>' : ''}
          </td>
          <td>${item.p1Score}</td>
          <td>${item.p2Score}</td>
          <td>${item.p3Score}</td>
          <td><span class="score-badge ${scoreClass}">${item.totalScore.toFixed(2)}</span></td>
          <td style="color:${item.notes ? '#ef4444' : '#94a3b8'}">${item.notes || 'Hợp lệ'}</td>
          <td style="text-align:center; white-space:nowrap;" onclick="event.stopPropagation()">
            <button class="btn btn-primary btn-sm" onclick="window.app.openReviewModal('${item.id}')" style="margin-right:4px;">👁️ Xem</button>
            <button class="btn btn-outline btn-sm" onclick="window.app.deleteGradedPaper('${item.id}')" style="color:var(--danger); border-color:#fca5a5; padding:3px 8px;" title="Xóa bài thi này">🗑 Xóa</button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  // ============================================================
  // GIAO DIỆN TRA CỨU & XEM BÀI: SỐ BÁO DANH HOẶC HỌ TÊN HỌC SINH
  // ============================================================
  openPaperLookupModal(defaultMode = 'sbd') {
    if (defaultMode) this.state.lookupMode = defaultMode;
    this.renderPaperLookupModal();
    const modal = document.getElementById('paperLookupModal');
    if (modal) modal.classList.add('active');
  }

  closePaperLookupModal() {
    const modal = document.getElementById('paperLookupModal');
    if (modal) modal.classList.remove('active');
  }

  setLookupMode(mode) {
    this.state.lookupMode = mode;
    this.state.lookupQuery = '';
    this.state.lookupSelectedId = '';
    this.renderPaperLookupModal();
  }

  setLookupQuery(query) {
    this.state.lookupQuery = query;
    this.state.lookupSelectedId = '';
    this.renderPaperLookupModal();
  }

  onSelectLookupStudent(id) {
    this.state.lookupSelectedId = id;
    this.state.lookupQuery = '';
    this.renderPaperLookupModal();
  }

  clearLookupFilter() {
    this.state.lookupQuery = '';
    this.state.lookupSelectedId = '';
    this.renderPaperLookupModal();
  }

  renderPaperLookupModal() {
    const body = document.getElementById('paperLookupModalBody');
    const footerInfo = document.getElementById('lookupModalFooterInfo');
    if (!body) return;

    const list = this.state.gradedList || [];
    if (footerInfo) {
      footerInfo.textContent = `Tổng cộng: ${list.length} bài thi đã chấm trong hệ thống`;
    }

    if (list.length === 0) {
      body.innerHTML = `
        <div style="text-align:center; padding:45px 20px;">
          <div style="font-size:48px; margin-bottom:10px;">📋</div>
          <h4 style="font-size:1.15rem; color:#1e1b4b; font-weight:800; margin-bottom:6px;">Chưa Có Bài Thi Nào Được Chấm</h4>
          <p style="font-size:0.88rem; color:#64748b; max-width:480px; margin:0 auto 18px;">
            Hệ thống chưa ghi nhận bài thi nào. Bạn có thể chấm bài từ camera hoặc tệp ảnh ở Tab <strong>Chấm Bài</strong>, hoặc bấm nút bên dưới để tạo bài mẫu kiểm tra ngay.
          </p>
          <button class="btn btn-primary" onclick="window.app.scanSampleDemoSheet(); window.app.renderPaperLookupModal();" style="font-weight:700;">
            ⚡ Thêm Bài Mẫu & Mở Xem Bài
          </button>
        </div>
      `;
      return;
    }

    const mode = this.state.lookupMode || 'sbd'; // 'sbd' | 'name' | 'all'
    const query = (this.state.lookupQuery || '').toLowerCase().trim();
    const selectedId = this.state.lookupSelectedId || '';

    let filtered = list;
    if (selectedId) {
      filtered = list.filter(item => item.id === selectedId);
    } else if (query) {
      if (mode === 'sbd') {
        filtered = list.filter(item => String(item.sbd).toLowerCase().includes(query));
      } else if (mode === 'name') {
        filtered = list.filter(item => (item.name || '').toLowerCase().includes(query));
      } else {
        filtered = list.filter(item => String(item.sbd).includes(query) || (item.name || '').toLowerCase().includes(query));
      }
    }

    const sbdOptions = list.map(item => `
      <option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>
        ${item.sbd} - ${item.name || 'Chưa có tên'} (${item.totalScore.toFixed(2)}đ - Lớp ${item.className || '12A'})
      </option>
    `).join('');

    const nameOptions = list.map(item => `
      <option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>
        ${item.name || 'Chưa có tên'} - SBD: ${item.sbd} (${item.totalScore.toFixed(2)}đ - Lớp ${item.className || '12A'})
      </option>
    `).join('');

    let rowsHtml = '';
    if (filtered.length === 0) {
      rowsHtml = `<tr><td colspan="11" style="text-align:center; padding:30px; color:#64748b;">Không tìm thấy bài thi nào phù hợp với từ khóa "${query}".</td></tr>`;
    } else {
      filtered.forEach((item, idx) => {
        const scoreClass = item.totalScore >= 8.0 ? 'score-high' : (item.totalScore >= 5.0 ? 'score-mid' : 'score-low');
        const hasMissingSbd = !item.sbd || item.sbd === '00000000' || item.sbd.length < 8;
        const hasInvalidCode = !this.state.activeExamKeys || !this.state.activeExamKeys[item.examCode];

        rowsHtml += `
          <tr style="cursor:pointer;" onclick="window.app.openReviewModal('${item.id}')" title="Bấm để xem bài thi gốc và chi tiết 3 phần">
            <td style="text-align:center; font-weight:600; color:#64748b;">${idx + 1}</td>
            <td>
              <strong style="color:#1e1b4b; font-family:monospace; font-size:0.95rem;">${item.sbd}</strong>
              ${hasMissingSbd ? '<span class="badge-tag" style="background:#fef3c7; color:#b45309; font-size:0.68rem; margin-left:3px; padding:1px 5px; border-radius:4px;" title="Số báo danh chưa tô hoặc chưa đủ 8 số">⚠️ Thiếu SBD</span>' : ''}
            </td>
            <td><strong style="color:#0f172a;">${item.name || '<span style="color:#94a3b8">Chưa có tên</span>'}</strong></td>
            <td><span class="class-tag-pill" style="font-size:0.75rem;">${item.className || '12A'}</span></td>
            <td>
              <span class="badge-tag" style="background:#e0e7ff; color:#3730a3; font-weight:700;">${item.examCode}</span>
              ${hasInvalidCode ? '<span class="badge-tag" style="background:#fee2e2; color:#b91c1c; font-size:0.68rem; margin-left:3px; padding:1px 5px; border-radius:4px;" title="Mã đề chưa có đáp án trong hệ thống">⚠️ Chưa có ĐA</span>' : ''}
            </td>
            <td style="text-align:center; font-weight:600; color:#334155;">${item.p1Score}đ</td>
            <td style="text-align:center; font-weight:600; color:#334155;">${item.p2Score}đ</td>
            <td style="text-align:center; font-weight:600; color:#334155;">${item.p3Score}đ</td>
            <td style="text-align:center;"><span class="score-badge ${scoreClass}">${item.totalScore.toFixed(2)}</span></td>
            <td style="font-size:0.8rem; color:${item.notes ? '#ef4444' : '#10b981'}; font-weight:500;">${item.notes || '✓ Hợp lệ'}</td>
            <td style="text-align:center; white-space:nowrap;" onclick="event.stopPropagation()">
              <button class="btn btn-primary btn-sm" onclick="window.app.openReviewModal('${item.id}')" style="box-shadow:0 2px 6px rgba(79, 70, 229, 0.25); font-weight:700; margin-right:4px;">
                👁️ Xem bài
              </button>
              <button class="btn btn-outline btn-sm" onclick="window.app.deleteGradedPaper('${item.id}')" style="color:var(--danger); border-color:#fca5a5; padding:3px 8px; font-weight:600;" title="Xóa bài thi này">
                🗑 Xóa
              </button>
            </td>
          </tr>
        `;
      });
    }

    body.innerHTML = `
      <!-- Tùy chọn 1 trong 2: SỐ BÁO DANH HOẶC HỌ TÊN HỌC SINH -->
      <div style="margin-bottom:12px;">
        <label class="form-label" style="font-weight:700; color:#1e1b4b; margin-bottom:8px; display:block;">
          👉 Bước 1: Giáo viên tùy chọn 1 trong 2 phương thức tra cứu:
        </label>
        <div class="lookup-selector-grid">
          <div class="lookup-choice-card ${mode === 'sbd' ? 'active' : ''}" onclick="window.app.setLookupMode('sbd')">
            <div class="lookup-choice-icon">🪪</div>
            <div class="text-wrap">
              <strong>Theo Số Báo Danh</strong>
              <small>Tìm và xem bài theo SBD 8 chữ số</small>
            </div>
          </div>
          <div class="lookup-choice-card ${mode === 'name' ? 'active' : ''}" onclick="window.app.setLookupMode('name')">
            <div class="lookup-choice-icon">👤</div>
            <div class="text-wrap">
              <strong>Theo Họ Tên Học Sinh</strong>
              <small>Tìm và xem bài theo Họ và Tên</small>
            </div>
          </div>
          <div class="lookup-choice-card ${mode === 'all' ? 'active' : ''}" onclick="window.app.setLookupMode('all')">
            <div class="lookup-choice-icon">📋</div>
            <div class="text-wrap">
              <strong>Hiển Thị Tất Cả (${list.length} bài)</strong>
              <small>Xem trọn vẹn danh sách bài đã chấm</small>
            </div>
          </div>
        </div>
      </div>

      <!-- Hộp chọn / tìm kiếm theo phương thức đã chọn -->
      <div class="lookup-filter-box">
        ${mode === 'sbd' ? `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <label style="font-weight:700; font-size:0.88rem; color:#1e1b4b; margin:0;">
              🪪 Chọn hoặc nhập Số Báo Danh học sinh:
            </label>
            ${(query || selectedId) ? `<button class="btn btn-outline btn-sm" onclick="window.app.clearLookupFilter()">✕ Xem tất cả</button>` : ''}
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap:10px;">
            <div class="search-box-container" style="margin:0;">
              <span class="search-icon">🔍</span>
              <input type="text" placeholder="Gõ Số Báo Danh (ví dụ: 12000003)..." 
                     value="${query}" 
                     oninput="window.app.setLookupQuery(this.value)">
            </div>
            <select class="form-control" style="font-weight:600; cursor:pointer;" onchange="window.app.onSelectLookupStudent(this.value)">
              <option value="">-- Hoặc bấm chọn SBD từ danh sách (${list.length} học sinh) --</option>
              ${sbdOptions}
            </select>
          </div>
          <div class="lookup-chips-list">
            <span style="font-size:0.75rem; color:#64748b; font-weight:600; align-self:center; margin-right:4px;">Gợi ý nhanh:</span>
            ${list.slice(0, 10).map(it => `
              <button class="lookup-chip-btn ${selectedId === it.id ? 'active' : ''}" onclick="window.app.onSelectLookupStudent('${it.id}')">
                🪪 ${it.sbd} (${it.name || 'HS'})
              </button>
            `).join('')}
          </div>
        ` : mode === 'name' ? `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
            <label style="font-weight:700; font-size:0.88rem; color:#1e1b4b; margin:0;">
              👤 Chọn hoặc nhập Họ và Tên học sinh:
            </label>
            ${(query || selectedId) ? `<button class="btn btn-outline btn-sm" onclick="window.app.clearLookupFilter()">✕ Xem tất cả</button>` : ''}
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap:10px;">
            <div class="search-box-container" style="margin:0;">
              <span class="search-icon">🔍</span>
              <input type="text" placeholder="Gõ Họ và Tên học sinh (ví dụ: Quỳnh Anh)..." 
                     value="${query}" 
                     oninput="window.app.setLookupQuery(this.value)">
            </div>
            <select class="form-control" style="font-weight:600; cursor:pointer;" onchange="window.app.onSelectLookupStudent(this.value)">
              <option value="">-- Hoặc bấm chọn Họ Tên từ danh sách (${list.length} học sinh) --</option>
              ${nameOptions}
            </select>
          </div>
          <div class="lookup-chips-list">
            <span style="font-size:0.75rem; color:#64748b; font-weight:600; align-self:center; margin-right:4px;">Gợi ý nhanh:</span>
            ${list.slice(0, 10).map(it => `
              <button class="lookup-chip-btn ${selectedId === it.id ? 'active' : ''}" onclick="window.app.onSelectLookupStudent('${it.id}')">
                👤 ${it.name || it.sbd}
              </button>
            `).join('')}
          </div>
        ` : `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:700; font-size:0.88rem; color:#1e1b4b;">📋 Đang hiển thị toàn bộ ${filtered.length} bài thi đã chấm</span>
            <div class="search-box-container" style="margin:0; width:300px;">
              <span class="search-icon">🔍</span>
              <input type="text" placeholder="Tìm kiếm nhanh..." value="${query}" oninput="window.app.setLookupQuery(this.value)">
            </div>
          </div>
        `}
      </div>

      <!-- BẢNG KẾT QUẢ XUẤT HIỆN NHƯ ẢNH ĐÍNH KÈM -->
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
        <div style="padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:0.86rem; color:#1e1b4b; font-weight:700;">
            📊 Bảng Bài Làm (${filtered.length} bài) — Nhấn nút <strong style="color:#4338ca;">"👁️ Xem bài"</strong> ở cột Thao tác để soi chi tiết bài làm gốc
          </div>
        </div>
        <div class="table-responsive" style="max-height:360px; overflow-y:auto;">
          <table class="data-table" style="font-size:0.88rem; margin:0;">
            <thead>
              <tr>
                <th style="width:48px; text-align:center;">STT</th>
                <th>Số báo danh</th>
                <th>Họ và tên học sinh</th>
                <th>Lớp</th>
                <th>Mã đề</th>
                <th style="text-align:center;">TN 4LC</th>
                <th style="text-align:center;">Đúng / Sai</th>
                <th style="text-align:center;">Trả lời ngắn</th>
                <th style="text-align:center;">Tổng điểm</th>
                <th>Trạng thái</th>
                <th style="text-align:center; width:140px;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================
  // BỘ ĐIỀU KHIỂN & BẢNG TẠI TAB CHẤM BÀI
  // ==========================================
  setScanLookupMode(mode) {
    this.state.scanCardLookupMode = mode;
    this.state.scanCardLookupQuery = '';
    this.state.scanCardLookupSelectedId = '';
    this.renderScanLookupControls();
    this.renderRecentScanTable();
  }

  setScanLookupQuery(query) {
    this.state.scanCardLookupQuery = query;
    this.state.scanCardLookupSelectedId = '';
    this.renderRecentScanTable();
  }

  onSelectScanLookupStudent(id) {
    this.state.scanCardLookupSelectedId = id;
    this.state.scanCardLookupQuery = '';
    this.renderRecentScanTable();
  }

  clearScanLookupFilter() {
    this.state.scanCardLookupQuery = '';
    this.state.scanCardLookupSelectedId = '';
    this.renderScanLookupControls();
    this.renderRecentScanTable();
  }

  renderScanLookupControls() {
    const container = document.getElementById('scanLookupControls');
    if (!container) return;

    const list = this.state.gradedList || [];
    const mode = this.state.scanCardLookupMode || 'all';

    const sbdOptions = list.map(item => `
      <option value="${item.id}" ${item.id === this.state.scanCardLookupSelectedId ? 'selected' : ''}>
        ${item.sbd} - ${item.name || 'Chưa có tên'} (${item.totalScore.toFixed(2)}đ - Lớp ${item.className || '12A'})
      </option>
    `).join('');

    const nameOptions = list.map(item => `
      <option value="${item.id}" ${item.id === this.state.scanCardLookupSelectedId ? 'selected' : ''}>
        ${item.name || 'Chưa có tên'} - SBD: ${item.sbd} (${item.totalScore.toFixed(2)}đ - Lớp ${item.className || '12A'})
      </option>
    `).join('');

    container.innerHTML = `
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="font-weight:700; color:#1e1b4b; font-size:0.88rem;">👁️ Tùy chọn xem bài:</span>
            <div style="display:inline-flex; gap:6px;">
              <button class="btn btn-sm ${mode === 'sbd' ? 'btn-primary' : 'btn-outline'}" onclick="window.app.setScanLookupMode('sbd')" style="font-weight:700;">
                🪪 Theo Số Báo Danh
              </button>
              <button class="btn btn-sm ${mode === 'name' ? 'btn-primary' : 'btn-outline'}" onclick="window.app.setScanLookupMode('name')" style="font-weight:700;">
                👤 Theo Họ Tên Học Sinh
              </button>
              <button class="btn btn-sm ${mode === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="window.app.setScanLookupMode('all')">
                📋 Tất Cả (${list.length})
              </button>
            </div>
          </div>
          
          <button class="btn btn-outline btn-sm" onclick="window.app.openPaperLookupModal()" style="font-weight:600; color:#4f46e5; border-color:#c7d2fe;">
            ⛶ Mở Cửa Sổ Tra Cứu Toàn Màn Hình
          </button>
        </div>

        ${mode === 'sbd' ? `
          <div style="display:grid; grid-template-columns:1fr 1.5fr; gap:10px; margin-top:10px; padding-top:10px; border-top:1px dashed #e2e8f0;">
            <div class="search-box-container" style="margin:0;">
              <span class="search-icon">🔍</span>
              <input type="text" placeholder="Nhập Số Báo Danh (ví dụ: 12000003)..." 
                     value="${this.state.scanCardLookupQuery || ''}" 
                     oninput="window.app.setScanLookupQuery(this.value)">
            </div>
            <select class="form-control" style="font-weight:600; cursor:pointer;" onchange="window.app.onSelectScanLookupStudent(this.value)">
              <option value="">-- Chọn nhanh Số Báo Danh (${list.length} bài) --</option>
              ${sbdOptions}
            </select>
          </div>
        ` : mode === 'name' ? `
          <div style="display:grid; grid-template-columns:1fr 1.5fr; gap:10px; margin-top:10px; padding-top:10px; border-top:1px dashed #e2e8f0;">
            <div class="search-box-container" style="margin:0;">
              <span class="search-icon">🔍</span>
              <input type="text" placeholder="Nhập Họ Tên học sinh (ví dụ: Quỳnh Anh)..." 
                     value="${this.state.scanCardLookupQuery || ''}" 
                     oninput="window.app.setScanLookupQuery(this.value)">
            </div>
            <select class="form-control" style="font-weight:600; cursor:pointer;" onchange="window.app.onSelectScanLookupStudent(this.value)">
              <option value="">-- Chọn nhanh Họ Tên học sinh (${list.length} bài) --</option>
              ${nameOptions}
            </select>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderRecentScanTable() {
    const container = document.getElementById('scanRecentTableContainer');
    const countEl = document.getElementById('scanRecentCount');
    if (countEl) countEl.textContent = this.state.gradedList.length;
    if (!container) return;

    const list = this.state.gradedList;
    const mode = this.state.scanCardLookupMode || 'all';
    const query = (this.state.scanCardLookupQuery || '').toLowerCase().trim();
    const selectedId = this.state.scanCardLookupSelectedId || '';

    // Lọc theo chế độ đang chọn
    let filtered = list;
    if (selectedId) {
      filtered = list.filter(item => item.id === selectedId);
    } else if (query) {
      if (mode === 'sbd') {
        filtered = list.filter(item => String(item.sbd).toLowerCase().includes(query));
      } else if (mode === 'name') {
        filtered = list.filter(item => (item.name || '').toLowerCase().includes(query));
      } else {
        filtered = list.filter(item => String(item.sbd).includes(query) || (item.name || '').toLowerCase().includes(query));
      }
    }

    let rowsHtml = '';
    if (list.length === 0) {
      rowsHtml = `
        <tr>
          <td colspan="11" style="text-align:center; padding:35px 20px; color:#64748b;">
            <div style="font-size:2rem; margin-bottom:6px;">📋</div>
            <strong style="color:#1e1b4b; font-size:0.95rem;">Chưa có bài thi nào trong bảng điểm phiên này</strong>
            <p style="font-size:0.85rem; color:#64748b; margin:6px 0 12px;">
              Bấm nút <strong>"⚡ Thêm Bài Mẫu"</strong> ở góc trên bên phải hoặc chọn ảnh bài thi ở <strong>Bước 1</strong> và bấm <strong>"🚀 BẮT ĐẦU CHẤM BÀI NGAY"</strong> để bắt đầu.
            </p>
            <button class="btn btn-primary btn-sm" onclick="window.app.scanSampleDemoSheet()" style="font-weight:700;">
              ⚡ Chấm Thử 1 Phiếu Mẫu Để Xem Bài Ngay
            </button>
          </td>
        </tr>
      `;
    } else if (filtered.length === 0) {
      rowsHtml = `
        <tr>
          <td colspan="11" style="text-align:center; padding:30px 20px; color:#64748b;">
            Không tìm thấy bài thi nào phù hợp với bộ lọc hiện tại. 
            <button class="btn btn-outline btn-sm" style="margin-left:8px;" onclick="window.app.clearScanLookupFilter()">✕ Xem tất cả</button>
          </td>
        </tr>
      `;
    } else {
      filtered.forEach((item, idx) => {
        const scoreClass = item.totalScore >= 8.0 ? 'score-high' : (item.totalScore >= 5.0 ? 'score-mid' : 'score-low');
        const hasMissingSbd = !item.sbd || item.sbd === '00000000' || item.sbd.length < 8;
        const hasInvalidCode = !this.state.activeExamKeys || !this.state.activeExamKeys[item.examCode];

        rowsHtml += `
          <tr style="cursor:pointer;" onclick="window.app.openReviewModal('${item.id}')" title="Bấm để xem bài thi gốc và chi tiết 3 phần">
            <td style="text-align:center; font-weight:600; color:#64748b;">${idx + 1}</td>
            <td>
              <strong style="color:#1e1b4b; font-family:monospace; font-size:0.95rem;">${item.sbd}</strong>
              ${hasMissingSbd ? '<span class="badge-tag" style="background:#fef3c7; color:#b45309; font-size:0.68rem; margin-left:3px; padding:1px 5px; border-radius:4px;" title="Số báo danh chưa tô hoặc chưa đủ 8 số">⚠️ Thiếu SBD</span>' : ''}
            </td>
            <td><strong style="color:#0f172a;">${item.name || '<span style="color:#94a3b8">Chưa có tên</span>'}</strong></td>
            <td><span class="class-tag-pill" style="font-size:0.75rem;">${item.className || '12A'}</span></td>
            <td>
              <span class="badge-tag" style="background:#e0e7ff; color:#3730a3; font-weight:700;">${item.examCode}</span>
              ${hasInvalidCode ? '<span class="badge-tag" style="background:#fee2e2; color:#b91c1c; font-size:0.68rem; margin-left:3px; padding:1px 5px; border-radius:4px;" title="Mã đề chưa có đáp án trong hệ thống">⚠️ Chưa có ĐA</span>' : ''}
            </td>
            <td style="text-align:center; font-weight:600; color:#334155;">${item.p1Score}đ</td>
            <td style="text-align:center; font-weight:600; color:#334155;">${item.p2Score}đ</td>
            <td style="text-align:center; font-weight:600; color:#334155;">${item.p3Score}đ</td>
            <td style="text-align:center;"><span class="score-badge ${scoreClass}">${item.totalScore.toFixed(2)}</span></td>
            <td style="font-size:0.8rem; color:${item.notes ? '#ef4444' : '#10b981'}; font-weight:500;">${item.notes || '✓ Hợp lệ'}</td>
            <td style="text-align:center; white-space:nowrap;" onclick="event.stopPropagation()">
              <button class="btn btn-primary btn-sm" onclick="window.app.openReviewModal('${item.id}')" style="box-shadow:0 2px 6px rgba(79, 70, 229, 0.25); font-weight:700; margin-right:4px;">
                👁️ Xem bài
              </button>
              <button class="btn btn-outline btn-sm" onclick="window.app.deleteGradedPaper('${item.id}')" style="color:var(--danger); border-color:#fca5a5; padding:3px 8px; font-weight:600;" title="Xóa bài thi này">
                🗑 Xóa
              </button>
            </td>
          </tr>
        `;
      });
    }

    container.innerHTML = `
      <div class="table-responsive" style="max-height:480px; overflow-y:auto;">
        <table class="data-table" style="font-size:0.88rem;">
          <thead>
            <tr>
              <th style="width:48px; text-align:center;">STT</th>
              <th>Số báo danh</th>
              <th>Họ và tên học sinh</th>
              <th>Lớp</th>
              <th>Mã đề</th>
              <th style="text-align:center;">TN 4LC</th>
              <th style="text-align:center;">Đúng / Sai</th>
              <th style="text-align:center;">Trả lời ngắn</th>
              <th style="text-align:center;">Tổng điểm</th>
              <th>Trạng thái</th>
              <th style="text-align:center; width:140px;">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  // ==========================================
  // CHẤM LẠI TOÀN BỘ BÀI ĐÃ QUÉT
  // ==========================================
  async regradeAllSubmissions() {
    if (!this.state.gradedList || this.state.gradedList.length === 0) {
      this.showToast("Chưa có bài thi nào đã quét để chấm lại!", "warning");
      return;
    }

    this.showToast(`Đang chấm lại toàn bộ ${this.state.gradedList.length} bài theo đáp án & thang điểm mới...`, "info");

    let updatedCount = 0;
    this.state.gradedList.forEach(item => {
      if (item.scannedData) {
        const key = this.state.activeExamKeys[item.examCode] || null;
        const newGrading = window.omrEngine.calculateGrade(item.scannedData, key, this.state.gradingRules);
        item.p1Score = newGrading.p1Score;
        item.p2Score = newGrading.p2Score;
        item.p3Score = newGrading.p3Score;
        item.totalScore = newGrading.totalScore;
        item.notes = newGrading.notes;
        item.details = newGrading.details;
        updatedCount++;
      }
    });

    await this.saveState();
    this.renderRecentScanTable();
    this.renderGradedTable();
    this.updateStatsBar();
    this.updateClassBreakdown();
    this.showToast(`Đã chấm lại thành công ${updatedCount} bài!`, "success");
  }

  // ==========================================
  // XÓA BÀI THI & XÓA KẾT QUẢ ĐÃ CHẤM
  // ==========================================
  async deleteGradedPaper(id) {
    const item = this.state.gradedList.find(p => p.id === id);
    if (!item) return;

    const displayName = item.name ? `${item.name} (SBD: ${item.sbd})` : `SBD: ${item.sbd}`;
    if (!confirm(`Bạn có chắc chắn muốn xóa bài thi của "${displayName}" không?\n(Sau khi xóa bài này sẽ bị loại khỏi bảng điểm)`)) {
      return;
    }

    this.state.gradedList = this.state.gradedList.filter(p => p.id !== id);
    await this.saveState();

    this.renderRecentScanTable();
    this.renderGradedTable();
    this.renderScanLookupControls();
    this.updateStatsBar();
    this.updateClassBreakdown();

    // Cập nhật lại modal tra cứu nếu đang mở
    const lookupModal = document.getElementById('paperLookupModal');
    if (lookupModal && lookupModal.classList.contains('active')) {
      this.renderPaperLookupModal();
    }

    // Xử lý modal xem bài nếu đang mở bài này
    const reviewModal = document.getElementById('reviewModal');
    if (reviewModal && reviewModal.classList.contains('active')) {
      if (this.state.currentReviewItem && this.state.currentReviewItem.id === id) {
        if (this.state.gradedList.length === 0) {
          this.closeReviewModal();
        } else {
          if (this.state.currentReviewIndex >= this.state.gradedList.length) {
            this.state.currentReviewIndex = this.state.gradedList.length - 1;
          }
          this.renderCurrentReview();
        }
      }
    }

    this.showToast(`Đã xóa bài thi của ${displayName}!`, "info");
  }

  async deleteCurrentReviewPaper() {
    if (!this.state.currentReviewItem) return;
    await this.deleteGradedPaper(this.state.currentReviewItem.id);
  }

  async clearAllGradedPapers() {
    if (!this.state.gradedList || this.state.gradedList.length === 0) {
      this.showToast("Hiện tại chưa có bài thi nào được chấm để xóa!", "info");
      return;
    }

    if (confirm("⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ kết quả các bài đã chấm để bắt đầu đợt mới?\n(Nếu cần lưu lại kết quả này, hãy bấm 'Sao Lưu' trước)")) {
      this.state.gradedList = [];
      await this.saveState();
      this.renderRecentScanTable();
      this.renderGradedTable();
      this.renderScanLookupControls();
      this.updateStatsBar();
      this.updateClassBreakdown();

      const lookupModal = document.getElementById('paperLookupModal');
      if (lookupModal && lookupModal.classList.contains('active')) {
        this.renderPaperLookupModal();
      }

      this.closeReviewModal();
      this.showToast("Đã xóa sạch kết quả đợt chấm!", "info");
    }
  }

  updateStatsBar() {
    const countEl = document.getElementById('gradedCountStat');
    if (countEl) countEl.textContent = this.state.gradedList.length;

    const avgEl = document.getElementById('gradedAvgStat');
    if (avgEl) {
      const total = this.state.gradedList.length;
      if (total === 0) {
        avgEl.textContent = "0.0";
      } else {
        const sum = this.state.gradedList.reduce((acc, curr) => acc + curr.totalScore, 0);
        avgEl.textContent = (sum / total).toFixed(2);
      }
    }
  }

  updateClassBreakdown() {
    const container = document.getElementById('classBreakdownContainer');
    if (!container) return;
    const list = this.state.gradedList;
    if (!list || list.length === 0) {
      container.innerHTML = '';
      return;
    }

    const grouped = {};
    list.forEach(item => {
      const cls = (item.className || this.state.examMeta.className || "Chưa phân lớp").trim();
      if (!grouped[cls]) grouped[cls] = 0;
      grouped[cls]++;
    });

    const classNames = Object.keys(grouped);
    if (classNames.length <= 1) {
      const singleClass = classNames[0] || this.state.examMeta.className || "12A";
      container.innerHTML = `
        <div class="class-breakdown-banner">
          <div class="class-breakdown-info">
            <span style="font-size:1.3rem;">📌</span>
            <div>
              <strong>Đợt chấm đơn lớp:</strong> Lớp <span class="class-tag-pill">${singleClass}</span> (${list.length} bài thi đã chấm)
              <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">Dữ liệu sẽ được lưu chuẩn vào thư mục riêng của lớp ${singleClass}.</div>
            </div>
          </div>
        </div>
      `;
    } else {
      let pillsHtml = '';
      classNames.forEach(c => {
        pillsHtml += `<span class="class-tag-pill">Lớp ${c}: <strong>${grouped[c]}</strong> bài</span> `;
      });

      container.innerHTML = `
        <div class="class-breakdown-banner" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-color:#f59e0b;">
          <div class="class-breakdown-info">
            <span style="font-size:1.4rem;">⚡</span>
            <div>
              <strong style="color:#92400e;">Phát hiện nhiều lớp trong đợt chấm (${classNames.length} lớp - ${list.length} bài):</strong>
              <div style="margin-top:4px;">${pillsHtml}</div>
              <div style="font-size:0.75rem; color:#b45309; margin-top:4px;">
                ✨ <strong>Chế độ Tự Động Rã Lớp đã kích hoạt</strong>: Khi Xuất Excel, Tải ZIP hoặc Lưu vào máy tính, hệ thống sẽ tự động tách riêng từng lớp thành từng file và thư mục riêng!
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  // ==========================================
  // XEM BÀI HỌC SINH CHI TIẾT & ĐẦY ĐỦ 3 PHẦN
  // ==========================================
  openReviewModal(id) {
    const idx = this.state.gradedList.findIndex(s => s.id === id);
    if (idx === -1) return;

    this.state.currentReviewIndex = idx;
    this.state.currentReviewZoom = 1.0;
    this.renderCurrentReview();

    const modal = document.getElementById('reviewModal');
    if (modal) modal.classList.add('active');
  }

  renderCurrentReview() {
    const list = this.state.gradedList;
    const idx = this.state.currentReviewIndex;
    if (idx < 0 || idx >= list.length) return;

    const item = list[idx];
    this.state.currentReviewItem = item;

    // 1. Header Info với ô chỉnh sửa SBD, Mã đề và nút Lưu & Chấm lại
    const headerInfo = document.getElementById('reviewHeaderInfo');
    if (headerInfo) {
      const activeCodes = Object.keys(this.state.activeExamKeys || {});
      const codeOptionsHtml = activeCodes.map(c => `<option value="${c}">${c}</option>`).join('');

      headerInfo.innerHTML = `
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
          <div class="review-student-title" id="reviewStudentNameDisplay">${item.name || "Học sinh"}</div>
          <span class="class-tag-pill" id="reviewClassNameDisplay">Lớp: <strong>${item.className || "Chưa có"}</strong></span>
          <span class="review-score-badge" id="reviewScoreBadgeDisplay">${item.totalScore.toFixed(2)}đ</span>
        </div>

        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px; background:#f1f5f9; padding:4px 8px; border-radius:8px; border:1px solid #cbd5e1;">
          <label style="font-size:0.78rem; font-weight:700; color:#334155; margin:0;">🪪 SBD:</label>
          <input type="text" id="editReviewSbd" maxlength="8" class="form-control" 
                 value="${item.sbd || ''}" 
                 placeholder="8 chữ số" 
                 title="Chỉnh sửa Số báo danh bằng tay"
                 style="width:95px; height:28px; padding:2px 6px; font-size:0.85rem; font-weight:700; text-align:center; border:1.5px solid #6366f1; border-radius:6px; background:#ffffff;">
          
          <label style="font-size:0.78rem; font-weight:700; color:#334155; margin:0; margin-left:4px;">📑 Mã đề:</label>
          <input type="text" id="editReviewExamCode" list="reviewExamCodeList" maxlength="6" class="form-control" 
                 value="${item.examCode || ''}" 
                 placeholder="Mã đề" 
                 title="Chỉnh sửa Mã đề thi bằng tay"
                 style="width:80px; height:28px; padding:2px 6px; font-size:0.85rem; font-weight:700; text-align:center; border:1.5px solid #6366f1; border-radius:6px; background:#ffffff;">
          <datalist id="reviewExamCodeList">
            ${codeOptionsHtml}
          </datalist>

          <button class="btn btn-primary btn-sm" onclick="window.app.regradeCurrentReview()" 
                  title="Lưu SBD/Mã đề mới và chấm lại bài thi ngay lập tức"
                  style="height:28px; padding:0 10px; font-size:0.78rem; font-weight:700; display:flex; align-items:center; gap:4px; box-shadow:0 2px 4px rgba(79,70,229,0.3);">
            <span>💾 Lưu & Chấm lại</span>
          </button>
        </div>
      `;
    }

    // 2. Footer Info
    const footerInfo = document.getElementById('reviewModalFooterInfo');
    if (footerInfo) {
      footerInfo.textContent = `Bài ${idx + 1} / ${list.length} (Dùng phím mũi tên ⬅ ➡ để lật bài)`;
    }

    // 3. Render Body
    const body = document.getElementById('reviewModalBody');
    if (!body) return;

    // Chi tiết Phần I
    let p1Html = '';
    if (item.details && item.details.p1) {
      item.details.p1.forEach(d => {
        const cls = d.isCorrect ? 'correct' : 'wrong';
        p1Html += `
          <div class="part1-pill-item ${cls}">
            <span style="font-weight:700">Câu ${d.q}</span>
            <span style="font-size:0.85rem; font-weight:800;">${d.actual || '—'}</span>
            <span style="font-size:0.68rem; opacity:0.85">(ĐA: ${d.expected})</span>
          </div>
        `;
      });
    }

    // Chi tiết Phần II
    let p2Html = '';
    if (item.details && item.details.p2) {
      item.details.p2.forEach(d => {
        let subCols = '';
        if (d.subItems) {
          d.subItems.forEach(s => {
            const isOk = s.isCorrect;
            const bg = isOk ? '#dcfce7' : '#fee2e2';
            const color = isOk ? '#166534' : '#991b1b';
            subCols += `
              <div class="part2-sub-col" style="background:${bg}; color:${color};">
                <strong>${s.item})</strong> ${s.actual || '—'} <span style="font-size:0.65rem">(${s.expected})</span>
              </div>
            `;
          });
        }
        p2Html += `
          <div class="part2-review-item">
            <div style="display:flex; justify-content:space-between; font-size:0.82rem; font-weight:700;">
              <span>Câu ${d.q} (Đúng ${d.correctCount}/4 ý)</span>
              <span style="color:var(--primary)">+${d.qPoint.toFixed(2)}đ</span>
            </div>
            <div class="part2-sub-row">${subCols}</div>
          </div>
        `;
      });
    }

    // Chi tiết Phần III
    let p3Html = '';
    if (item.details && item.details.p3) {
      let rows = '';
      item.details.p3.forEach(d => {
        const cls = d.isCorrect ? '#166534' : '#991b1b';
        const icon = d.isCorrect ? '✓ Đúng' : '✕ Sai';
        rows += `
          <tr>
            <td><strong>Câu ${d.q}</strong></td>
            <td style="font-weight:700; color:${cls}">${d.actual || '—'}</td>
            <td>${d.expected}</td>
            <td style="font-weight:700; color:${cls}">${icon}</td>
          </tr>
        `;
      });
      p3Html = `
        <table class="part3-review-table">
          <thead>
            <tr>
              <th>Câu</th>
              <th>Học sinh điền</th>
              <th>Đáp án chuẩn</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }

    body.innerHTML = `
      <div class="review-grid-layout">
        <!-- Cột Trái: Ảnh bài thi có zoom % -->
        <div class="review-image-pane">
          <div class="review-image-toolbar" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
            <span style="font-weight:700; font-size:0.82rem; color:#f8fafc;">📷 SBD: ${item.sbd} - Mã đề: ${item.examCode}</span>
            <div class="zoom-toolbar">
              <button class="btn-zoom ${this.state.currentReviewZoom === 1.0 ? 'active' : ''}" onclick="window.app.setReviewZoom(1.0)" title="Vừa chiều rộng trang A4">📐 Vừa trang</button>
              <button class="btn-zoom ${this.state.currentReviewZoom === 0.75 ? 'active' : ''}" onclick="window.app.setReviewZoom(0.75)">75%</button>
              <button class="btn-zoom ${this.state.currentReviewZoom === 1.0 ? 'active' : ''}" onclick="window.app.setReviewZoom(1.0)">100%</button>
              <button class="btn-zoom ${this.state.currentReviewZoom === 1.25 ? 'active' : ''}" onclick="window.app.setReviewZoom(1.25)">125%</button>
              <button class="btn-zoom ${this.state.currentReviewZoom === 1.5 ? 'active' : ''}" onclick="window.app.setReviewZoom(1.5)" title="Phóng to 150%">🔍 150%</button>
              <button class="btn-zoom ${this.state.currentReviewZoom === 2.0 ? 'active' : ''}" onclick="window.app.setReviewZoom(2.0)">200%</button>
              <div style="display:inline-flex; align-items:center; gap:2px; background:rgba(0,0,0,0.35); padding:2px 5px; border-radius:5px; margin-left:3px;">
                <button class="btn-zoom" style="padding:1px 6px;" onclick="window.app.stepReviewZoom(-0.1)" title="Thu nhỏ 10%">-</button>
                <span id="reviewZoomPercentBadge" style="font-size:0.75rem; font-weight:800; color:#fbbf24; min-width:38px; text-align:center;">${Math.round((this.state.currentReviewZoom || 1.0) * 100)}%</span>
                <button class="btn-zoom" style="padding:1px 6px;" onclick="window.app.stepReviewZoom(0.1)" title="Phóng to 10%">+</button>
              </div>
            </div>
          </div>
          <div class="review-image-scroll" id="reviewImgContainer" style="overflow:auto; height:calc(100% - 44px); background:#1e293b; text-align:center; padding:10px;">
            <img id="reviewPaperImg" src="${item.previewImage}" 
                 style="transform: scale(${this.state.currentReviewZoom || 1.0}); transform-origin: top center; transition: transform 0.15s ease; max-width:100%; box-shadow:0 6px 20px rgba(0,0,0,0.5);" />
          </div>
        </div>

        <!-- Cột Phải: Chi tiết điểm 3 phần -->
        <div class="review-details-pane">
          <!-- Tóm tắt điểm -->
          <div class="card" style="background:#f8fafc; padding:10px 14px; margin-bottom:12px; display:flex; justify-content:space-around; text-align:center;">
            <div>
              <div style="font-size:0.75rem; color:var(--text-muted)">Phần I (TN 4LC)</div>
              <strong style="font-size:1.05rem; color:#1e1b4b;">${item.p1Score}đ</strong>
            </div>
            <div style="border-left:1px solid #e2e8f0;"></div>
            <div>
              <div style="font-size:0.75rem; color:var(--text-muted)">Phần II (Đúng/Sai)</div>
              <strong style="font-size:1.05rem; color:#1e1b4b;">${item.p2Score}đ</strong>
            </div>
            <div style="border-left:1px solid #e2e8f0;"></div>
            <div>
              <div style="font-size:0.75rem; color:var(--text-muted)">Phần III (Điền số)</div>
              <strong style="font-size:1.05rem; color:#1e1b4b;">${item.p3Score}đ</strong>
            </div>
          </div>

          <!-- Phần I -->
          <div class="review-section-box">
            <div class="review-section-title">
              <span>📝 Phần I: Trắc Nghiệm 4 Lựa Chọn</span>
              <span style="font-size:0.75rem; color:var(--text-muted)">Xanh: Đúng • Đỏ: Sai</span>
            </div>
            <div class="part1-grid-list">${p1Html || '<div style="color:#94a3b8">Không có câu hỏi</div>'}</div>
          </div>

          <!-- Phần II -->
          <div class="review-section-box">
            <div class="review-section-title">
              <span>⚖️ Phần II: Câu Hỏi Đúng / Sai</span>
              <span style="font-size:0.75rem; color:var(--text-muted)">4 ý a, b, c, d</span>
            </div>
            <div>${p2Html || '<div style="color:#94a3b8">Không có câu hỏi</div>'}</div>
          </div>

          <!-- Phần III -->
          <div class="review-section-box">
            <div class="review-section-title">
              <span>🔢 Phần III: Câu Trả Lời Ngắn (Điền số)</span>
            </div>
            <div>${p3Html || '<div style="color:#94a3b8">Không có câu hỏi</div>'}</div>
          </div>
        </div>
      </div>
    `;
  }

  setReviewZoom(level) {
    this.state.currentReviewZoom = level;
    const img = document.getElementById('reviewPaperImg');
    if (img) {
      img.style.transform = `scale(${level})`;
      img.style.transformOrigin = 'top center';
    }
    const badge = document.getElementById('reviewZoomPercentBadge');
    if (badge) badge.textContent = `${Math.round(level * 100)}%`;

    const btns = document.querySelectorAll('#reviewModal .btn-zoom');
    btns.forEach(b => {
      const txt = b.textContent.trim();
      b.classList.toggle('active', txt === `${Math.round(level * 100)}%` || (level === 1.0 && txt.includes('Vừa trang')));
    });

    const container = document.getElementById('reviewImgContainer');
    if (container && level >= 1.2) {
      container.scrollTop = 0;
    }
  }

  stepReviewZoom(delta) {
    const cur = this.state.currentReviewZoom || 1.0;
    const next = Math.max(0.5, Math.min(3.0, Math.round((cur + delta) * 10) / 10));
    this.setReviewZoom(next);
  }

  zoomReviewImage(delta) {
    this.stepReviewZoom(delta);
  }

  resetZoomReviewImage() {
    this.setReviewZoom(1.0);
  }

  /**
   * Chỉnh sửa Số báo danh hoặc Mã đề bằng tay trực tiếp trên bài thi và chấm lại ngay lập tức
   */
  async regradeCurrentReview() {
    const list = this.state.gradedList;
    const idx = this.state.currentReviewIndex;
    if (idx < 0 || idx >= list.length) return;
    const item = list[idx];

    const inputSbd = document.getElementById('editReviewSbd');
    const inputCode = document.getElementById('editReviewExamCode');
    if (!inputSbd || !inputCode) return;

    let newSbd = inputSbd.value.trim();
    let newExamCode = inputCode.value.trim();

    if (!newSbd) {
      this.showToast("Vui lòng nhập Số báo danh!", "warning");
      inputSbd.focus();
      return;
    }

    // Nếu SBD toàn số và ngắn hơn 8 ký tự -> tự động thêm số 0 ở đầu (padding zero chuẩn 8 số)
    if (/^\d+$/.test(newSbd) && newSbd.length < 8) {
      newSbd = newSbd.padStart(8, '0');
      inputSbd.value = newSbd;
    }

    if (!newExamCode) {
      this.showToast("Vui lòng nhập Mã đề thi!", "warning");
      inputCode.focus();
      return;
    }

    // Tìm kiếm thông tin học sinh theo SBD mới trong Danh sách học sinh
    let studentName = "Học sinh SBD " + newSbd;
    let studentClass = "Tự do";
    let foundInList = false;

    if (this.state.studentList && this.state.studentList.length > 0) {
      const found = this.state.studentList.find(s => String(s.sbd).trim() === newSbd);
      if (found) {
        studentName = found.name;
        studentClass = found.className;
        foundInList = true;
      }
    }

    // Lấy đáp án của mã đề mới
    const key = (this.state.activeExamKeys && this.state.activeExamKeys[newExamCode])
      ? this.state.activeExamKeys[newExamCode]
      : null;

    if (!key) {
      this.showToast(`⚠️ Cảnh báo: Mã đề ${newExamCode} chưa có đáp án trong hệ thống! Vui lòng kiểm tra lại.`, "warning");
    }

    // Cập nhật SBD và Mã đề
    item.sbd = newSbd;
    item.name = studentName;
    item.className = studentClass;
    item.examCode = newExamCode;

    if (item.scannedData) {
      item.scannedData.sbd = newSbd;
      item.scannedData.examCode = newExamCode;
    }

    // Chấm lại điểm
    const grading = window.omrEngine.calculateGrade(item.scannedData, key, this.state.gradingRules);

    let notes = grading.notes || "";
    if (!foundInList && this.state.studentList && this.state.studentList.length > 0) {
      const w = "SBD không có trong danh sách";
      notes = notes ? `${w}; ${notes}` : w;
    }
    if (!key) {
      const wKey = `Chưa có đáp án mã đề ${newExamCode}`;
      notes = notes ? `${wKey}; ${notes}` : wKey;
    }

    item.p1Score = grading.p1Score;
    item.p2Score = grading.p2Score;
    item.p3Score = grading.p3Score;
    item.totalScore = grading.totalScore;
    item.notes = notes;
    item.details = grading.details;

    // Vẽ lại ảnh bài làm có overlay mới (dùng cleanImage nếu có, hoặc ảnh hiện tại)
    const baseImgSrc = item.cleanImage || item.previewImage;
    if (baseImgSrc) {
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = baseImgSrc;
        });
        const cvs = document.createElement('canvas');
        cvs.width = img.naturalWidth || 1662;
        cvs.height = img.naturalHeight || 2346;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0);

        window.omrEngine.drawOverlayMarks(ctx, cvs.width, cvs.height, item.scannedData, grading);
        item.previewImage = cvs.toDataURL('image/jpeg', 0.88);
      } catch (err) {
        console.warn("Không thể vẽ lại overlay:", err);
      }
    }

    // Lưu ngay vào IndexedDB
    await this.saveState();

    // Cập nhật toàn bộ giao diện
    this.renderCurrentReview();
    this.renderRecentScanTable();
    this.renderGradedTable();
    this.renderScanLookupControls();
    this.updateStatsBar();
    this.updateClassBreakdown();

    const lookupModal = document.getElementById('paperLookupModal');
    if (lookupModal && lookupModal.classList.contains('active')) {
      this.renderPaperLookupModal();
    }

    this.showToast(`✅ Đã lưu & chấm lại: SBD ${newSbd} - Mã đề ${newExamCode} (${item.totalScore.toFixed(2)}đ)`, "success");
  }

  nextReviewItem() {
    const list = this.state.gradedList;
    if (list.length === 0) return;
    this.state.currentReviewIndex = (this.state.currentReviewIndex + 1) % list.length;
    this.renderCurrentReview();
  }

  prevReviewItem() {
    const list = this.state.gradedList;
    if (list.length === 0) return;
    this.state.currentReviewIndex = (this.state.currentReviewIndex - 1 + list.length) % list.length;
    this.renderCurrentReview();
  }

  downloadCurrentPaperImage() {
    const item = this.state.currentReviewItem;
    if (!item || !item.previewImage) {
      this.showToast("Không tìm thấy ảnh bài làm này!", "warning");
      return;
    }
    const a = document.createElement('a');
    a.href = item.previewImage;
    const safeName = (item.name || "HocSinh").replace(/\s+/g, '_');
    a.download = `BaiThi_SBD_${item.sbd}_${safeName}_${item.totalScore}d.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.showToast("Đã tải ảnh bài làm của học sinh!", "success");
  }

  closeReviewModal() {
    const modal = document.getElementById('reviewModal');
    if (modal) modal.classList.remove('active');
  }

  // ==========================================
  // SAO LƯU, MỞ LẠI & CÂY THƯ MỤC
  // ==========================================
  exportBackupFile() {
    const list = this.state.gradedList;
    const payload = {
      version: "2025.1",
      type: "OMR_EXAM_BACKUP",
      exportedAt: new Date().toISOString(),
      examMeta: this.state.examMeta,
      gradingRules: this.state.gradingRules,
      activeExamKeys: this.state.activeExamKeys,
      studentList: this.state.studentList,
      gradedList: this.state.gradedList
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const safeExam = (this.state.examMeta.examName || "KyThi").replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
    const safeSubj = (this.state.examMeta.subject || "Mon").replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
    const safeCls = (this.state.examMeta.className || "Lop").replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `SaoLuu_${safeExam}_${safeSubj}_${safeCls}_${dateStr}.omr`;

    window.exportZipHandler.downloadBlob(blob, fileName);
    this.showToast(`Đã sao lưu hồ sơ kỳ thi thành công (${list.length} bài)!`, "success");
  }

  importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.examMeta && !data.gradedList) {
          throw new Error("Tệp không đúng định dạng hồ sơ thi .omr");
        }

        if (data.examMeta) this.state.examMeta = data.examMeta;
        if (data.gradingRules) this.state.gradingRules = data.gradingRules;
        if (data.activeExamKeys) this.state.activeExamKeys = data.activeExamKeys;
        if (data.studentList) this.state.studentList = data.studentList;
        if (data.gradedList) this.state.gradedList = data.gradedList;

        await this.saveState();
        this.renderMetaInputs();
        this.renderGradingInputs();
        this.renderAnswerKeyEditor();
        this.renderStudentListTable();
        this.renderGradedTable();
        this.updateStatsBar();
        this.updateClassBreakdown();
        this.switchTab('tab-results');
        this.showToast(`Đã mở thành công hồ sơ kỳ thi! (${this.state.gradedList.length} bài thi)`, "success");
      } catch (err) {
        this.showToast("Không thể mở tệp: " + err.message, "danger");
      }
    };
    reader.readAsText(file);
  }

  async saveToDirectoryTree() {
    if (this.state.gradedList.length === 0) {
      this.showToast("Chưa có bài thi nào được chấm để lưu vào cây thư mục!", "warning");
      return;
    }
    this.showToast("Đang tạo cây thư mục và lưu bài làm trên máy tính...", "info");
    try {
      const response = await fetch('/api/save-tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examMeta: this.state.examMeta,
          gradingRules: this.state.gradingRules,
          activeExamKeys: this.state.activeExamKeys,
          studentList: this.state.studentList,
          gradedList: this.state.gradedList
        })
      });

      const res = await response.json();
      if (res.success) {
        this.showToast(`Đã lưu thành công ${res.classCount} lớp (${res.totalSaved} bài)!`, "success");
        if (confirm(`Đã lưu thành công vào cây thư mục máy tính:\n${res.baseDir}\n\nBạn có muốn mở thư mục này ngay bây giờ không?`)) {
          await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: res.baseDir })
          });
        }
      } else {
        this.showToast("Lỗi lưu thư mục: " + res.error, "danger");
      }
    } catch (e) {
      this.showToast("Lỗi kết nối máy chủ: " + e.message, "danger");
    }
  }

  // Exports
  async exportScoreExcel() {
    if (this.state.gradedList.length === 0) {
      this.showToast("Chưa có dữ liệu bài thi nào để xuất điểm!", "warning");
      return;
    }

    this.showToast("Đang định dạng bảng điểm Times New Roman và kẻ khung...", "info");
    try {
      const fileName = await window.excelHandler.exportScoreExcelFile(this.state.gradedList, this.state.examMeta);
      this.showToast(`✓ Đã tải xuống bảng điểm: ${fileName}!`, "success");
    } catch (err) {
      console.error("Lỗi xuất Excel:", err);
      const wb = window.excelHandler.exportScoreWorkbook(this.state.gradedList, this.state.examMeta);
      const fileName = window.excelHandler.getExportFileName(this.state.examMeta);
      XLSX.writeFile(wb, fileName);
      this.showToast("Đã tải xuống tệp Excel bảng điểm!", "success");
    }
  }

  async exportScoreZip() {
    if (this.state.gradedList.length === 0) {
      this.showToast("Chưa có dữ liệu bài thi để đóng gói!", "warning");
      return;
    }

    this.showToast("Đang nén toàn bộ tệp Excel và ảnh bài làm...", "info");
    const wb = window.excelHandler.exportScoreWorkbook(this.state.gradedList, this.state.examMeta);
    const { blob, fileName } = await window.exportZipHandler.createResultsZip(
      this.state.gradedList,
      wb,
      this.state.examMeta
    );

    window.exportZipHandler.downloadBlob(blob, fileName);
    this.showToast("Đã xuất file nén kết quả (.ZIP) thành công!", "success");
  }

  shareResultsModal() {
    alert(`TÍNH NĂNG CHIA SẺ & LƯU TRỮ:\n\n1. Nếu dung lượng file nén dưới 25MB: Bạn có thể đính kèm file ZIP vừa tải về gửi qua Email cá nhân hoặc Email tổ bộ môn.\n2. Nếu dung lượng lớn: Bạn có thể kéo thả tệp ZIP vào Google Drive của trường để lưu trữ lâu dài.`);
  }
}

// Khởi chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
  window.app.init();
});
