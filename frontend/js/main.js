// Hàm tự động cập nhật thẻ "Lịch hôm nay" theo đúng ngày thực tế
function switchView(viewName) {
  const targetView = document.getElementById(`view-${viewName}`);
  if (!targetView) {
    console.error(`Không tìm thấy giao diện: view-${viewName}`);
    return;
  }

  document.querySelectorAll('.page-view').forEach(view => {
    view.classList.toggle('active', view === targetView);
  });

  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.classList.toggle('active', link.dataset.view === viewName);
  });

  document.getElementById('mainNav')?.classList.remove('show');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

let systemSpecialties = [];
let specialtiesLoading = true;
let specialtiesLoadError = '';
let systemDoctors = [];
let doctorsLoading = true;
let doctorsLoadError = '';
let publicDirectoryRequestId = 0;
const FEATURED_DOCTORS_COUNT = 3;

function escapeDoctorMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function normalizeDoctorSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi')
    .trim();
}

function isHomeDoctorFilterActive() {
  return Boolean(
    document.getElementById('homeDoctorSearch')?.value.trim() ||
    document.getElementById('homeDoctorSpecFilter')?.value
  );
}

function renderDoctorCard(doctor) {
  const id = escapeDoctorMarkup(doctor.id);
  const name = escapeDoctorMarkup(doctor.full_name);
  const specialtyData = systemSpecialties.find(item => item.id === doctor.specialty_id);
  const specialtyPresentation = SPECIALTY_PRESENTATION[doctor.specialty_id] || {};
  const specialty = escapeDoctorMarkup(specialtyPresentation.label || specialtyData?.name || doctor.specialty_name);
  const specialtyIcon = escapeDoctorMarkup(specialtyPresentation.icon || 'fa-stethoscope');
  const description = escapeDoctorMarkup(doctor.bio);
  const room = escapeDoctorMarkup(doctor.room);
  const experience = escapeDoctorMarkup(doctor.experience_years);
  const avatar = escapeDoctorMarkup(doctor.avatar);

  return `
    <article class="doctor-card" data-doctor-id="${id}">
      <div class="doctor-avatar-wrap">
        <img class="doctor-avatar" src="${avatar}" alt="Ảnh minh họa bác sĩ ${name}" loading="lazy" decoding="async">
        <span class="doctor-avatar-label">Ảnh minh họa</span>
      </div>
      <div class="doctor-card-content">
        <span class="doctor-spec-tag"><i class="fa-solid ${specialtyIcon}" aria-hidden="true"></i>${specialty}</span>
        <h3 class="doctor-name">${name}</h3>
        <p class="doctor-bio">${description}</p>
        <div class="doctor-meta-list">
          <div class="doctor-meta-item"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>${experience} năm kinh nghiệm</span></div>
          <div class="doctor-meta-item"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>${room}</span></div>
        </div>
      </div>
      <div class="doctor-card-actions">
        <button type="button" class="btn btn-primary" data-doctor-action="book" data-doctor-id="${id}" ${doctor.bookingAvailable ? '' : 'disabled'}>Đặt lịch khám</button>
        <button type="button" class="btn btn-light-outline" data-doctor-action="details" data-doctor-id="${id}">Xem chi tiết</button>
      </div>
    </article>
  `;
}

function filterDoctors(doctors, searchValue, specialtyValue) {
  const query = normalizeDoctorSearch(searchValue);
  return doctors.filter(doctor => {
    const doctorName = String(doctor.name || doctor.full_name || doctor.display_name || '').trim();
    const matchesQuery = !query || normalizeDoctorSearch(doctorName).includes(query);
    const matchesSpecialty = !specialtyValue || Number(doctor.specialty_id ?? doctor.specialtyId ?? doctor.specialty?.id ?? 0) === Number(specialtyValue);
    return matchesQuery && matchesSpecialty;
  });
}

function doctorListMessage() {
  if (doctorsLoading) return '<p class="doctor-empty-state" role="status">Đang tải danh sách bác sĩ...</p>';
  if (doctorsLoadError) {
    return `<div class="doctor-empty-state" role="alert"><p>Chưa thể tải danh sách bác sĩ.</p><button type="button" class="doctor-filter-reset" onclick="initializeDoctors()">Thử lại</button></div>`;
  }
  return '';
}

function renderDoctorLists() {
  const homeGrid = document.getElementById('homeDoctorsGrid');
  const pageGrid = document.getElementById('pageDoctorsGrid');
  const pageSearch = document.getElementById('pageDoctorSearch');
  const pageSelect = document.getElementById('pageDoctorSelect');
  const homeSearch = document.getElementById('homeDoctorSearch');
  const homeSelect = document.getElementById('homeDoctorSpecFilter');
  const homeSummary = document.getElementById('homeDoctorResultsSummary');
  const summary = document.getElementById('doctorResultsSummary');
  const loadingOrError = doctorListMessage();

  if (homeGrid) {
    const filtersActive = isHomeDoctorFilterActive();
    const matches = filterDoctors(systemDoctors, homeSearch?.value || '', homeSelect?.value || '');
    const visibleDoctors = filtersActive
      ? matches
      : systemDoctors.slice(0, FEATURED_DOCTORS_COUNT);

    homeGrid.innerHTML = loadingOrError || (visibleDoctors.length
      ? visibleDoctors.map(renderDoctorCard).join('')
      : systemDoctors.length
        ? '<div class="doctor-empty-state"><p>Không tìm thấy bác sĩ phù hợp</p><button type="button" class="doctor-filter-reset" data-doctor-filter-reset>Xóa bộ lọc</button></div>'
        : '<p class="doctor-empty-state" role="status">Hiện chưa có bác sĩ đang hoạt động.</p>');
    if (homeSummary) {
      homeSummary.textContent = filtersActive ? `Tìm thấy ${matches.length} bác sĩ` : '';
      homeSummary.hidden = !filtersActive;
    }
  }

  if (pageGrid) {
    const doctors = filterDoctors(systemDoctors, pageSearch?.value || '', pageSelect?.value || '');
    pageGrid.innerHTML = loadingOrError || (doctors.length
      ? doctors.map(renderDoctorCard).join('')
      : systemDoctors.length
        ? '<p class="doctor-empty-state">Không tìm thấy bác sĩ phù hợp.</p>'
        : '<p class="doctor-empty-state" role="status">Hiện chưa có bác sĩ đang hoạt động.</p>');
    if (summary) {
      summary.textContent = `Hiển thị ${doctors.length} / ${systemDoctors.length} bác sĩ`;
    }
  }
}

function renderSpecialtyCards() {
  const grid = document.getElementById('specialtyCardsGrid');
  if (!grid) return;
  if (specialtiesLoading) {
    grid.innerHTML = '<p class="booking-inline-status" role="status">Đang tải danh sách chuyên khoa...</p>';
    return;
  }
  if (specialtiesLoadError) {
    grid.innerHTML = '<div class="doctor-empty-state" role="alert"><p>Chưa thể tải danh sách chuyên khoa.</p><button type="button" class="doctor-filter-reset" onclick="initializeDoctors()">Thử lại</button></div>';
    return;
  }
  if (!systemSpecialties.length) {
    grid.innerHTML = '<p class="booking-inline-status" role="status">Hiện chưa có chuyên khoa đang hoạt động.</p>';
    return;
  }
  grid.innerHTML = systemSpecialties.map(specialty => {
    const presentation = SPECIALTY_PRESENTATION[specialty.id] || {};
    return `
      <div class="specialty-card" style="align-items:center;">
        <div class="specialty-icon" style="margin-bottom:10px;"><i class="fa-solid ${escapeDoctorMarkup(presentation.icon || 'fa-stethoscope')}" aria-hidden="true"></i></div>
        <h3 class="specialty-name">${escapeDoctorMarkup(presentation.label || specialty.name)}</h3>
        <p class="specialty-desc">${escapeDoctorMarkup(specialty.description || '')}</p>
      </div>
    `;
  }).join('');
}

function populateDoctorFilters() {
  const homeSelect = document.getElementById('homeDoctorSpecFilter');
  const pageSelect = document.getElementById('pageDoctorSelect');
  const sidebar = document.getElementById('specialtySidebarList');
  const options = systemSpecialties.map(specialty => {
    const label = SPECIALTY_PRESENTATION[specialty.id]?.label || specialty.name;
    return `<option value="${escapeDoctorMarkup(specialty.id)}">${escapeDoctorMarkup(label)}</option>`;
  }).join('');

  if (homeSelect) homeSelect.innerHTML = '<option value="">Tất cả chuyên khoa</option>' + options;
  if (pageSelect) pageSelect.innerHTML = '<option value="">Tất cả chuyên khoa</option>' + options;

  if (sidebar) {
    sidebar.innerHTML = `
      <li><a href="#" class="active" data-spec=""><i class="fa-solid fa-border-all" aria-hidden="true"></i> Tất cả</a></li>
      ${systemSpecialties.map(specialty => {
        const presentation = SPECIALTY_PRESENTATION[specialty.id] || {};
        return `<li><a href="#" data-spec="${escapeDoctorMarkup(specialty.id)}"><i class="fa-solid ${escapeDoctorMarkup(presentation.icon || 'fa-stethoscope')}" aria-hidden="true"></i> ${escapeDoctorMarkup(presentation.label || specialty.name)}</a></li>`;
      }).join('')}
    `;
  }
}

function showDoctorDetails(doctor) {
  const modal = document.getElementById('doctorDetailModal');
  const body = document.getElementById('doctorModalBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <button type="button" class="doctor-detail-close" aria-label="Đóng hồ sơ bác sĩ">&times;</button>
    <img class="doctor-detail-avatar" src="${escapeDoctorMarkup(doctor.avatar)}" alt="Ảnh minh họa bác sĩ ${escapeDoctorMarkup(doctor.full_name)}">
    <span class="doctor-avatar-label doctor-detail-avatar-label">Ảnh minh họa</span>
    <span class="doctor-spec-tag">${escapeDoctorMarkup(SPECIALTY_PRESENTATION[doctor.specialty_id]?.label || systemSpecialties.find(item => item.id === doctor.specialty_id)?.name || doctor.specialty_name)}</span>
    <h2 class="doctor-detail-name" id="doctorDetailName">${escapeDoctorMarkup(doctor.full_name)}</h2>
    <p class="doctor-bio">${escapeDoctorMarkup(doctor.bio)}</p>
    <div class="doctor-meta-list">
      <div class="doctor-meta-item"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>${escapeDoctorMarkup(doctor.experience_years)} năm kinh nghiệm</span></div>
      <div class="doctor-meta-item"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>${escapeDoctorMarkup(doctor.room)}</span></div>
    </div>
    <button type="button" class="btn btn-primary doctor-detail-book" data-doctor-action="book" data-doctor-id="${escapeDoctorMarkup(doctor.id)}" ${doctor.bookingAvailable ? '' : 'disabled'}>Đặt lịch khám</button>
  `;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  body.querySelector('.doctor-detail-close')?.focus();
}

function closeDoctorDetails() {
  const modal = document.getElementById('doctorDetailModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function handleDoctorAction(event) {
  const actionButton = event.target.closest('[data-doctor-action]');
  if (!actionButton) return;

  const doctor = systemDoctors.find(item => String(item.id) === actionButton.dataset.doctorId);
  if (!doctor) {
    console.error(`Không tìm thấy hồ sơ bác sĩ có ID ${actionButton.dataset.doctorId}`);
    return;
  }

  if (actionButton.dataset.doctorAction === 'book') {
    closeDoctorDetails();
    quickBookDoctor(doctor.id);
  } else if (actionButton.dataset.doctorAction === 'details') {
    showDoctorDetails(doctor);
  }
}

async function initializeDoctors() {
  const requestId = ++publicDirectoryRequestId;
  specialtiesLoading = true;
  specialtiesLoadError = '';
  doctorsLoading = true;
  doctorsLoadError = '';
  renderSpecialtyCards();
  renderDoctorLists();
  renderBookingStep();

  const [specialtiesResult, doctorsResult] = await Promise.allSettled([
    fetchSpecialtiesList(),
    fetchDoctorsList()
  ]);
  if (requestId !== publicDirectoryRequestId) return;
  if (specialtiesResult.status === 'fulfilled') {
    systemSpecialties = specialtiesResult.value;
  } else {
    systemSpecialties = [];
    specialtiesLoadError = 'specialties';
    console.error('Không thể tải danh sách chuyên khoa:', specialtiesResult.reason?.message);
  }
  if (doctorsResult.status === 'fulfilled') {
    systemDoctors = doctorsResult.value;
  } else {
    systemDoctors = [];
    doctorsLoadError = 'doctors';
    console.error('Không thể tải danh sách bác sĩ:', doctorsResult.reason?.message);
  }
  specialtiesLoading = false;
  doctorsLoading = false;
  populateDoctorFilters();
  renderSpecialtyCards();
  renderDoctorLists();
  renderBookingStep();

  ['homeDoctorSearch', 'pageDoctorSearch'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderDoctorLists);
  });

  ['homeDoctorSpecFilter', 'pageDoctorSelect'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', event => {
      if (id === 'pageDoctorSelect') {
        const activeLink = document.querySelector('#specialtySidebarList [data-spec].active');
        activeLink?.classList.remove('active');
        document.querySelector(`#specialtySidebarList [data-spec="${CSS.escape(event.target.value)}"]`)?.classList.add('active');
      }
      renderDoctorLists();
    });
  });

  document.getElementById('homeDoctorsGrid')?.addEventListener('click', event => {
    if (!event.target.closest('[data-doctor-filter-reset]')) return;
    document.getElementById('homeDoctorSearch').value = '';
    document.getElementById('homeDoctorSpecFilter').value = '';
    renderDoctorLists();
  });

  document.getElementById('specialtySidebarList')?.addEventListener('click', event => {
    const link = event.target.closest('[data-spec]');
    if (!link) return;
    event.preventDefault();
    document.querySelectorAll('#specialtySidebarList [data-spec]').forEach(item => item.classList.toggle('active', item === link));
    const pageSelect = document.getElementById('pageDoctorSelect');
    if (pageSelect) pageSelect.value = link.dataset.spec;
    renderDoctorLists();
  });

  ['homeDoctorsGrid', 'pageDoctorsGrid', 'doctorModalBody'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', handleDoctorAction);
  });

  const modal = document.getElementById('doctorDetailModal');
  modal?.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('.doctor-detail-close')) closeDoctorDetails();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDoctorDetails();
  });
}

function renderDynamicHeroCalendar() {
  const titleEl = document.getElementById('dynamicCurrentDateTitle');
  const gridEl = document.getElementById('dynamicMiniWeekGrid');
  if (!titleEl || !gridEl) return;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0: CN, 1: T2, 2: T3, 3: T4, 4: T5, 5: T6, 6: T7
  const currentDate = now.getDate();
  const currentMonth = now.getMonth() + 1;

  const dayNamesFull = [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy'
  ];

  // Cập nhật dòng tiêu đề: VD "Thứ Năm, 5 tháng 11" (mai tự đổi thành "Thứ Sáu, 6 tháng 11")
  titleEl.textContent = `${dayNamesFull[dayOfWeek]}, ${currentDate} tháng ${currentMonth}`;

  // Danh sách 7 cột từ Thứ 2 đến Chủ Nhật
  const weekColumns = [
    { label: 'T2', jsDay: 1 },
    { label: 'T3', jsDay: 2 },
    { label: 'T4', jsDay: 3 },
    { label: 'T5', jsDay: 4 },
    { label: 'T6', jsDay: 5 },
    { label: 'T7', jsDay: 6 },
    { label: 'CN', jsDay: 0 }
  ];

  gridEl.innerHTML = weekColumns.map(col => {
    const isToday = col.jsDay === dayOfWeek;
    let indicatorHTML = '';

    if (isToday) {
      // Ngày hôm nay: hiện vòng tròn xanh đậm kèm số ngày thực tế
      indicatorHTML = `<div class="day-number-active">${currentDate}</div>`;
    } else if (col.jsDay === 6) {
      // Thứ 7 (nếu không phải hôm nay): hiện dấu ? nhỏ màu xám giống ảnh mẫu
      indicatorHTML = `<div class="dot-ring-gray">?</div>`;
    } else {
      // Các ngày khác trong tuần: hiện chấm tròn xanh nhỏ có viền mint nhạt giống ảnh mẫu
      indicatorHTML = `<div class="dot-ring-green"></div>`;
    }

    return `
      <div class="mini-day ${isToday ? 'active' : ''}">
        <span class="mini-day-label">${col.label}</span>
        <div class="day-slot-wrap">${indicatorHTML}</div>
      </div>
    `;
  }).join('');
}

// Khởi chạy ngay khi tải trang và tự động kiểm tra mỗi phút để đổi ngày khi qua 00:00 đêm
document.addEventListener('DOMContentLoaded', () => {
  initializeDoctors();
  renderDynamicHeroCalendar();
  setInterval(renderDynamicHeroCalendar, 60000);

  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get('view');
  if (requestedView === 'specialties' || requestedView === 'doctors') {
    switchView(requestedView);
  } else if (params.get('action') === 'booking') {
    startBooking();
  } else if (params.get('section') === 'lookup') {
    scrollToHomeSection('tra-cuu-lich-hen', 'lookup');
  }
});