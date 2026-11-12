let bookingState = {
  step: 1,
  specialtyId: '',
  specialtyName: '',
  doctorId: '',
  doctorName: '',
  room: '',
  date: '',
  timeSlot: '',
  patientName: '',
  patientPhone: '',
  patientEmail: '',
  patientGender: '',
  notes: '',
  availableDates: [],
  availableSlots: [],
  bookingWindowStart: '',
  bookingWindowEnd: '',
  viewedMonth: '',
  selectedShift: 'morning',
  scheduleSource: '',
  datesLoading: false,
  slotsLoading: false,
  availabilityError: '',
  slotConflictNotice: '',
  availabilityRequiresDoctorChange: false,
  bookingRequestKey: '',
  submitting: false
};

let availabilityRequestId = 0;
let verifiedAppointment = null;

function escapePatientMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatClinicDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);

  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNames = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  return `${dayNames[date.getUTCDay()]}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function scrollToHomeSection(sectionId, navView) {
  switchView('home');
  if (navView) {
    document.querySelectorAll('.nav-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === navView);
    });
  }

  window.setTimeout(() => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    section.focus({ preventScroll: true });
  }, 80);
}

function resetBookingState() {
  availabilityRequestId += 1;
  bookingState = {
    step: 1,
    specialtyId: '',
    specialtyName: '',
    doctorId: '',
    doctorName: '',
    room: '',
    date: '',
    timeSlot: '',
    patientName: '',
    patientPhone: '',
    patientEmail: '',
    patientGender: '',
    notes: '',
    availableDates: [],
    availableSlots: [],
    bookingWindowStart: '',
    bookingWindowEnd: '',
    viewedMonth: '',
    selectedShift: 'morning',
    scheduleSource: '',
    datesLoading: false,
    slotsLoading: false,
    availabilityError: '',
    slotConflictNotice: '',
    availabilityRequiresDoctorChange: false,
    bookingRequestKey: '',
    submitting: false
  };
}

function startBooking() {
  resetBookingState();
  renderBookingStep();
  scrollToHomeSection('dat-lich-kham');
}

function quickBookSpecialty(specialtyId) {
  const specialty = systemSpecialties.find(item => String(item.id) === String(specialtyId));
  if (!specialty) return;
  resetBookingState();
  bookingState.specialtyId = String(specialty.id);
  bookingState.specialtyName = specialty.name;
  bookingState.step = 2;
  renderBookingStep();
  scrollToHomeSection('dat-lich-kham');
}

function quickBookDoctor(docId) {
  const doctor = systemDoctors.find(item => String(item.id) === String(docId));
  const specialty = doctor && systemSpecialties.find(item => item.id === doctor.specialty_id);
  if (!doctor || !doctor.bookingAvailable || !specialty) return;
  resetBookingState();
  bookingState.specialtyId = String(specialty.id);
  bookingState.specialtyName = specialty.name;
  bookingState.doctorId = String(doctor.id);
  bookingState.doctorName = doctor.full_name;
  bookingState.room = doctor.room;
  bookingState.step = 3;
  renderBookingStep();
  loadAvailableDates();
  scrollToHomeSection('dat-lich-kham');
}

function getBookingDoctor() {
  return systemDoctors.find(doctor => String(doctor.id) === String(bookingState.doctorId));
}

function getClinicMonth(date) {
  return String(date || '').slice(0, 7);
}

function getClinicToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).reduce((values, part) => {
    if (part.type !== 'literal') values[part.type] = part.value;
    return values;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatClinicMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const [year, value] = month.split('-').map(Number);
  return `Tháng ${value}, ${year}`;
}

function getCalendarDateCells(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const count = Math.ceil((mondayOffset + lastDay) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1, index - mondayOffset + 1));
    return {
      value: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthNumber - 1
    };
  });
}

function changeBookingMonth(offset) {
  const activeMonth = bookingState.viewedMonth || getClinicMonth(bookingState.bookingWindowStart || getClinicToday());
  const [year, month] = activeMonth.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
  if (nextMonth < getClinicMonth(bookingState.bookingWindowStart) ||
      nextMonth > getClinicMonth(bookingState.bookingWindowEnd)) return;
  bookingState.viewedMonth = nextMonth;
  renderBookingStep();
}

function getSlotShift(slotTime) {
  const [hours, minutes] = String(slotTime).split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes >= 7 * 60 + 30 && totalMinutes < 11 * 60 + 30) return 'morning';
  if (totalMinutes >= 13 * 60 + 30 && totalMinutes < 17 * 60) return 'afternoon';
  return '';
}

function renderBookingSummary(date, showChangeDate = false) {
  const selectedDate = date
    ? `<p class="booking-summary-weekday">${escapePatientMarkup(formatClinicDate(date).split(',')[0])}</p>
       <p class="booking-summary-date">${escapePatientMarkup(date.split('-').reverse().join('/'))}</p>`
    : '<p class="booking-summary-empty">Hãy chọn một ngày còn lịch trống trên lịch.</p>';
  return `
    <aside class="booking-summary-card" aria-label="Thông tin lịch khám">
      <h4>${date ? (bookingState.step === 4 ? 'Ngày đã chọn' : 'Ngày khám đã chọn') : 'Ngày khám'}</h4>
      ${selectedDate}
      <dl class="booking-summary-details">
        <div><dt>Bác sĩ</dt><dd>${escapePatientMarkup(bookingState.doctorName)}</dd></div>
        <div><dt>Chuyên khoa</dt><dd>${escapePatientMarkup(bookingState.specialtyName)}</dd></div>
      </dl>
      ${showChangeDate ? '<button type="button" class="btn btn-light-outline booking-change-date" onclick="goToStep(3)">← Đổi ngày</button>' : ''}
    </aside>
  `;
}

function renderBookingStep() {
  const stepper = document.getElementById('bookingStepper');
  const box = document.getElementById('bookingStepContainer');
  if (!stepper || !box) return;

  const steps = [
    { num: 1, label: 'Chọn chuyên khoa', detail: bookingState.specialtyName },
    { num: 2, label: 'Chọn bác sĩ', detail: bookingState.doctorName },
    { num: 3, label: 'Ngày khám', detail: bookingState.step > 3 ? formatClinicDate(bookingState.date) : '' },
    { num: 4, label: 'Khung giờ', detail: bookingState.step > 4 ? bookingState.timeSlot.slice(0, 5) : '' },
    { num: 5, label: 'Xác nhận thông tin', detail: '' }
  ];

  stepper.setAttribute('role', 'group');
  stepper.setAttribute('aria-label', 'Quy trình đặt lịch gồm 5 bước');
  stepper.innerHTML = steps.map(step => {
    const completed = bookingState.step > step.num;
    const active = bookingState.step === step.num;
    const detail = step.detail ? `: ${step.detail}` : '';
    return `
      <button type="button" class="step-item ${active ? 'active' : (completed ? 'completed' : '')}"
        ${active ? 'aria-current="step"' : ''}
        aria-label="Bước ${step.num}: ${escapePatientMarkup(step.label)}${escapePatientMarkup(detail)}${completed ? ', hoàn tất' : ''}"
        ${bookingState.step <= step.num ? 'disabled' : ''}
        onclick="goToStep(${step.num})">
        <span class="step-circle">${completed ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : step.num}</span>
        <span class="step-label">${escapePatientMarkup(step.label)}</span>
        ${step.detail && completed ? `<small class="step-detail">${escapePatientMarkup(step.detail)}</small>` : ''}
        ${completed ? '<small class="step-complete-label">Hoàn tất</small>' : ''}
      </button>
    `;
  }).join('');

  if (bookingState.step === 1) {
    const specialtyStatus = specialtiesLoading
      ? '<p class="booking-inline-status" role="status">Đang tải danh sách chuyên khoa...</p>'
      : specialtiesLoadError
        ? '<p class="booking-inline-status booking-error" role="alert">Chưa thể tải danh sách chuyên khoa. <button type="button" class="booking-retry" onclick="initializeDoctors()">Thử lại</button></p>'
        : systemSpecialties.length
          ? ''
          : '<p class="booking-inline-status" role="status">Hiện chưa có chuyên khoa đang hoạt động.</p>';
    box.innerHTML = `
      <div class="booking-step-content">
        <div class="booking-step-info">
          <div class="booking-step-icon"><i class="fa-solid fa-stethoscope" aria-hidden="true"></i></div>
          <div>
            <div class="booking-step-caption">Bước 1</div>
            <h3 class="booking-step-title">Chọn chuyên khoa khám</h3>
            <p class="booking-step-description">Chọn chuyên khoa để xem bác sĩ phù hợp.</p>
          </div>
        </div>
        <div class="booking-step-controls">
          <div class="booking-field">
            <label for="stepSpecSelect">Chọn chuyên khoa</label>
            <select id="stepSpecSelect" class="filter-select" onchange="updateBookingSpecialty(this.value)" ${specialtiesLoading || specialtiesLoadError || !systemSpecialties.length ? 'disabled' : ''}>
              <option value="">Vui lòng chọn chuyên khoa</option>
              ${systemSpecialties.map(specialty => {
                const label = SPECIALTY_PRESENTATION[specialty.id]?.label || specialty.name;
                return `<option value="${escapePatientMarkup(specialty.id)}" ${String(bookingState.specialtyId) === String(specialty.id) ? 'selected' : ''}>${escapePatientMarkup(label)}</option>`;
              }).join('')}
            </select>
            ${specialtyStatus}
          </div>
          <button type="button" id="bookingNextButton" class="btn btn-primary" onclick="nextStep1()" ${systemSpecialties.some(item => String(item.id) === String(bookingState.specialtyId)) && !specialtiesLoading && !specialtiesLoadError ? '' : 'disabled'}>
            Tiếp theo <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
  } else if (bookingState.step === 2) {
    const specialtyDoctors = systemDoctors.filter(doctor => Number(doctor.specialty_id) === Number(bookingState.specialtyId));
    const doctors = specialtyDoctors.filter(doctor => doctor.bookingAvailable);
    const doctorStatus = doctors.length
      ? ''
      : doctorsLoading
        ? 'Đang tải danh sách bác sĩ...'
        : doctorsLoadError
          ? 'Chưa thể tải danh sách bác sĩ. Vui lòng thử lại.'
          : specialtyDoctors.length
            ? 'Bác sĩ hiện chưa thể nhận đặt lịch.'
            : 'Chưa có bác sĩ đang hoạt động trong chuyên khoa này.';
    const doctorStatusAction = doctorsLoadError
      ? '<button type="button" class="booking-retry" onclick="initializeDoctors()">Thử lại</button>'
      : '';
    box.innerHTML = `
      <div class="booking-step-content">
        <div class="booking-step-info">
          <div class="booking-step-icon"><i class="fa-solid fa-user-doctor" aria-hidden="true"></i></div>
          <div>
            <div class="booking-step-caption">Bước 2 · ${escapePatientMarkup(bookingState.specialtyName)}</div>
            <h3 class="booking-step-title">Chọn bác sĩ khám</h3>
            <p class="booking-step-description">Chọn bác sĩ thuộc chuyên khoa đã chọn.</p>
          </div>
        </div>
        <div class="booking-step-controls">
          <div class="booking-field">
            <label for="stepDocSelect">Bác sĩ</label>
            <select id="stepDocSelect" class="filter-select" onchange="updateBookingDoctorButton(this.value)" ${doctors.length ? '' : 'disabled'}>
              <option value="">Vui lòng chọn bác sĩ</option>
              ${doctors.map(doctor => `<option value="${escapePatientMarkup(doctor.id)}" ${String(bookingState.doctorId) === String(doctor.id) ? 'selected' : ''}>${escapePatientMarkup(doctor.full_name)} (${escapePatientMarkup(doctor.room)})</option>`).join('')}
            </select>
            ${doctors.length ? '' : `<p class="booking-inline-status" role="${doctorsLoadError ? 'alert' : 'status'}">${escapePatientMarkup(doctorStatus)} ${doctorStatusAction}</p>`}
          </div>
          <button type="button" class="btn btn-light-outline" onclick="goToStep(1)">Quay lại</button>
          <button type="button" id="bookingNextButton" class="btn btn-primary" onclick="nextStep2()" ${doctors.some(doctor => String(doctor.id) === String(bookingState.doctorId)) ? '' : 'disabled'}>
            Tiếp theo <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
  } else if (bookingState.step === 3) {
    const calendarMonth = bookingState.viewedMonth || getClinicMonth(bookingState.bookingWindowStart || getClinicToday());
    const calendarCells = getCalendarDateCells(calendarMonth);
    const startMonth = getClinicMonth(bookingState.bookingWindowStart || getClinicToday());
    const endMonth = getClinicMonth(bookingState.bookingWindowEnd || bookingState.bookingWindowStart || getClinicToday());
    const canGoPrevious = calendarMonth > startMonth;
    const canGoNext = calendarMonth < endMonth;
    const dateStatus = bookingState.datesLoading
      ? '<p class="booking-inline-status" role="status">Đang tải ngày khám có lịch trực...</p>'
      : bookingState.availabilityError
        ? `<p class="booking-inline-status booking-error" role="alert">${escapePatientMarkup(bookingState.availabilityError)} <button type="button" class="booking-retry" onclick="${bookingState.availabilityRequiresDoctorChange ? 'goToStep(2)' : 'loadAvailableDates()'}">${bookingState.availabilityRequiresDoctorChange ? 'Chọn bác sĩ khác' : 'Thử lại'}</button></p>`
        : bookingState.availableDates.length
          ? ''
          : '<p class="booking-inline-status" role="status">Chưa có ngày còn lịch trong thời gian đặt khám.</p>';
    const calendarDays = calendarCells.map(cell => {
      const available = cell.inMonth &&
        bookingState.availableDates.includes(cell.value) &&
        cell.value >= bookingState.bookingWindowStart &&
        new Date(`${cell.value}T00:00:00.000Z`).getUTCDay() !== 0;
      const selected = bookingState.date === cell.value;
      const weekday = new Date(`${cell.value}T00:00:00.000Z`).getUTCDay();
      const accessibleState = available
        ? 'Còn lịch trống'
        : !cell.inMonth
          ? 'Ngoài tháng đang xem'
          : weekday === 0
            ? 'Chủ nhật, nghỉ khám'
            : cell.value < bookingState.bookingWindowStart
              ? 'Ngày đã qua'
              : 'Không còn lịch trống';
      return `
        <button type="button"
          class="booking-calendar-day ${cell.inMonth ? '' : 'outside-month'} ${available ? 'available' : 'unavailable'} ${selected ? 'selected' : ''}"
          aria-label="${escapePatientMarkup(formatClinicDate(cell.value))}, ${accessibleState}${selected ? ', đã chọn' : ''}"
          aria-pressed="${selected}"
          ${available && !bookingState.datesLoading ? `onclick="updateBookingDate('${cell.value}')"` : 'disabled'}>
          <span>${cell.day}</span>
          <small aria-hidden="true">${selected ? '✓' : (available ? '●' : '–')}</small>
        </button>
      `;
    }).join('');
    box.innerHTML = `
      <div class="booking-step-content booking-step-content-column">
        <div class="booking-step-info">
          <div class="booking-step-icon"><i class="fa-regular fa-calendar-check" aria-hidden="true"></i></div>
          <div>
            <div class="booking-step-caption">Bước 3 · ${escapePatientMarkup(bookingState.doctorName)}</div>
            <h3 class="booking-step-title">Chọn ngày khám</h3>
            <p class="booking-step-description">${escapePatientMarkup(bookingState.specialtyName)}</p>
          </div>
        </div>
        <div class="booking-date-layout">
          <section class="booking-calendar" aria-label="Lịch chọn ngày khám">
            <div class="booking-calendar-heading">
              <h4>${escapePatientMarkup(formatClinicMonth(calendarMonth))}</h4>
              <div class="booking-calendar-navigation">
                <button type="button" aria-label="Tháng trước" onclick="changeBookingMonth(-1)" ${canGoPrevious ? '' : 'disabled'}>‹</button>
                <button type="button" aria-label="Tháng sau" onclick="changeBookingMonth(1)" ${canGoNext ? '' : 'disabled'}>›</button>
              </div>
            </div>
            <div class="booking-calendar-grid booking-calendar-weekdays" aria-hidden="true">
              ${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => `<span>${day}</span>`).join('')}
            </div>
            <div class="booking-calendar-grid booking-calendar-days">
              ${calendarDays}
            </div>
            <div class="booking-calendar-legend">
              <span><i class="available-mark" aria-hidden="true">●</i> Còn lịch trống</span>
              <span><i aria-hidden="true">–</i> Đã qua / nghỉ / kín</span>
            </div>
            ${dateStatus}
          </section>
          ${renderBookingSummary(bookingState.date)}
        </div>
        <div class="booking-step-actions booking-date-actions">
          <p>${bookingState.date
            ? `Đã chọn: ${escapePatientMarkup(formatClinicDate(bookingState.date))}`
            : 'Chưa chọn ngày khám'}</p>
          <div>
            <button type="button" class="btn btn-light-outline" onclick="goToStep(2)">Quay lại</button>
            <button type="button" id="bookingNextButton" class="btn btn-primary" onclick="nextStep3()" ${bookingState.date && bookingState.availableDates.includes(bookingState.date) && !bookingState.datesLoading ? '' : 'disabled'}>
              Tiếp tục chọn khung giờ <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  } else if (bookingState.step === 4) {
    const shiftSlots = bookingState.availableSlots.filter(slot => getSlotShift(slot.slot_time) === bookingState.selectedShift);
    const freeSlotCount = shiftSlots.filter(slot => !slot.is_booked).length;
    const morningCount = bookingState.availableSlots.filter(slot => getSlotShift(slot.slot_time) === 'morning' && !slot.is_booked).length;
    const afternoonCount = bookingState.availableSlots.filter(slot => getSlotShift(slot.slot_time) === 'afternoon' && !slot.is_booked).length;
    const slotStatus = bookingState.slotsLoading
      ? '<p class="booking-inline-status" role="status">Đang tải khung giờ còn trống...</p>'
      : bookingState.availabilityError
        ? `<p class="booking-inline-status booking-error" role="alert">${escapePatientMarkup(bookingState.availabilityError)} <button type="button" class="booking-retry" onclick="loadAvailableSlots()">Thử lại</button></p>`
        : bookingState.availableSlots.some(slot => !slot.is_booked)
          ? ''
          : '<p class="booking-inline-status" role="status">Không còn khung giờ trống trong ngày đã chọn. <button type="button" class="booking-retry" onclick="goToStep(3)">Chọn ngày khác</button></p>';
    box.innerHTML = `
      <div class="booking-step-content booking-step-content-column">
        <div class="booking-step-info">
          <div class="booking-step-icon"><i class="fa-regular fa-clock" aria-hidden="true"></i></div>
          <div>
            <div class="booking-step-caption">Bước 4 · ${escapePatientMarkup(bookingState.doctorName)}</div>
            <h3 class="booking-step-title">Chọn khung giờ khám</h3>
            <p class="booking-step-description">${escapePatientMarkup(bookingState.specialtyName)}</p>
          </div>
        </div>
        <div class="booking-time-layout">
          ${renderBookingSummary(bookingState.date, true)}
          <section class="booking-time-picker" aria-label="Chọn ca và khung giờ">
            <h4>Chọn ca khám</h4>
            <p class="booking-step-description">Chọn một khung giờ phù hợp với bạn.</p>
            <div class="booking-shift-tabs" role="group" aria-label="Ca khám">
              <button type="button" class="${bookingState.selectedShift === 'morning' ? 'selected' : ''}" aria-pressed="${bookingState.selectedShift === 'morning'}" onclick="selectBookingShift('morning')">
                Buổi sáng · 07:30–11:30 <span>Còn ${morningCount} giờ</span>
              </button>
              <button type="button" class="${bookingState.selectedShift === 'afternoon' ? 'selected' : ''}" aria-pressed="${bookingState.selectedShift === 'afternoon'}" onclick="selectBookingShift('afternoon')">
                Buổi chiều · 13:30–17:00 <span>Còn ${afternoonCount} giờ</span>
              </button>
            </div>
            ${bookingState.slotConflictNotice ? `<p class="booking-inline-status booking-error" role="alert">${escapePatientMarkup(bookingState.slotConflictNotice)} Chọn một khung giờ khác bên dưới.</p>` : ''}
            ${slotStatus}
            <div class="time-slots-grid" aria-live="polite">
              ${shiftSlots.map(slot => `
                <button type="button" class="time-slot-btn ${bookingState.timeSlot === slot.slot_time ? 'selected' : ''}"
                  aria-pressed="${bookingState.timeSlot === slot.slot_time}"
                  aria-label="${escapePatientMarkup(slot.label || String(slot.slot_time).slice(0, 5))}${slot.is_booked ? ', đã kín hoặc đang được giữ' : ', còn trống'}"
                  ${slot.is_booked || bookingState.slotsLoading ? 'disabled' : `onclick="pickSlot('${escapePatientMarkup(slot.slot_time)}')"`}>
                  ${escapePatientMarkup(slot.label || String(slot.slot_time).slice(0, 5))}
                  ${slot.is_booked ? '<small>Đã kín</small>' : ''}
                </button>
              `).join('')}
              ${!bookingState.slotsLoading && !shiftSlots.length ? '<p class="booking-inline-status">Ca này hiện không có khung giờ trong lịch.</p>' : ''}
            </div>
            ${bookingState.timeSlot ? `<div class="booking-selected-slot"><span>Khung giờ đang chọn</span><strong>${escapePatientMarkup(bookingState.timeSlot.slice(0, 5))} – ${escapePatientMarkup(bookingState.availableSlots.find(slot => slot.slot_time === bookingState.timeSlot)?.end_time?.slice(0, 5) || '')}</strong></div>` : ''}
            <p class="booking-slot-count" role="status">Còn ${freeSlotCount} khung giờ trong ca này.</p>
          </section>
        </div>
        <div class="booking-step-actions booking-date-actions">
          <p>${bookingState.timeSlot
            ? `Đã chọn: ${escapePatientMarkup(formatClinicDate(bookingState.date))} · ${escapePatientMarkup(bookingState.timeSlot.slice(0, 5))}`
            : `Ngày đã chọn: ${escapePatientMarkup(formatClinicDate(bookingState.date))} · Chưa chọn giờ`}</p>
          <div>
            <button type="button" class="btn btn-light-outline" onclick="goToStep(3)">Quay lại</button>
            <button type="button" class="btn btn-primary" onclick="nextStep4()" ${bookingState.timeSlot && !bookingState.slotsLoading && bookingState.availableSlots.some(slot => slot.slot_time === bookingState.timeSlot && !slot.is_booked) ? '' : 'disabled'}>
              Tiếp tục xác nhận <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  } else if (bookingState.step === 5) {
    box.innerHTML = `
      <div class="booking-step-content booking-step-content-column">
        <div class="booking-step-info">
          <div class="booking-step-icon"><i class="fa-solid fa-clipboard-check" aria-hidden="true"></i></div>
          <div>
            <div class="booking-step-caption">Bước 5 · Xác nhận thông tin</div>
            <h3 class="booking-step-title">${escapePatientMarkup(bookingState.specialtyName)} · ${escapePatientMarkup(bookingState.doctorName)}</h3>
            <p class="booking-step-description">${escapePatientMarkup(formatClinicDate(bookingState.date))} · ${escapePatientMarkup(bookingState.timeSlot.slice(0, 5))} · ${escapePatientMarkup(bookingState.room)}</p>
          </div>
        </div>
        <form class="booking-patient-form" onsubmit="submitAppointment(event)">
          <div class="form-group">
            <label for="bkName">Họ và tên *</label>
            <input type="text" id="bkName" class="form-control" value="${escapePatientMarkup(bookingState.patientName)}" autocomplete="name" maxlength="100" aria-describedby="bkNameError" aria-invalid="false" oninput="clearBookingFieldError('bkName')" required>
            <small id="bkNameError" class="booking-field-error" hidden></small>
          </div>
          <div class="form-group">
            <label for="bkPhone">Số điện thoại *</label>
            <input type="tel" id="bkPhone" class="form-control" value="${escapePatientMarkup(bookingState.patientPhone)}" autocomplete="tel" inputmode="tel" pattern="(0|\\+84)[0-9]{8,10}" title="Nhập số điện thoại Việt Nam gồm 9–11 chữ số, bắt đầu bằng 0 hoặc +84." aria-describedby="bkPhoneError" aria-invalid="false" oninput="clearBookingFieldError('bkPhone')" required>
            <small id="bkPhoneError" class="booking-field-error" hidden></small>
          </div>
          <div class="form-group">
            <label for="bkEmail">Email *</label>
            <input type="email" id="bkEmail" class="form-control" value="${escapePatientMarkup(bookingState.patientEmail)}" autocomplete="email" maxlength="120" aria-describedby="bkEmailError" aria-invalid="false" oninput="clearBookingFieldError('bkEmail')" required>
            <small id="bkEmailError" class="booking-field-error" hidden></small>
          </div>
          <div class="form-group">
            <label for="bkGender">Giới tính *</label>
            <select id="bkGender" class="form-control" aria-describedby="bkGenderError" aria-invalid="false" onchange="clearBookingFieldError('bkGender')" required>
              <option value="">Vui lòng chọn</option>
              ${['Nam', 'Nữ', 'Khác'].map(gender => `<option value="${gender}" ${bookingState.patientGender === gender ? 'selected' : ''}>${gender}</option>`).join('')}
            </select>
            <small id="bkGenderError" class="booking-field-error" hidden></small>
          </div>
          <div class="form-group booking-reason-field">
            <label for="bkNotes">Lý do khám / triệu chứng *</label>
            <input type="text" id="bkNotes" class="form-control" value="${escapePatientMarkup(bookingState.notes)}" maxlength="2000" aria-describedby="bkNotesError" aria-invalid="false" oninput="clearBookingFieldError('bkNotes')" required>
            <small id="bkNotesError" class="booking-field-error" hidden></small>
          </div>
          <p id="bookingSubmitStatus" class="booking-submit-status" role="status" aria-live="polite"></p>
          <div class="booking-step-actions">
            <button type="button" class="btn btn-light-outline" onclick="goToStep(4)">Quay lại</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check" aria-hidden="true"></i> Hoàn tất đặt lịch</button>
          </div>
        </form>
      </div>
    `;
  }
}

function updateBookingSpecialty(value) {
  const specialty = systemSpecialties.find(item => String(item.id) === String(value));
  const specialtyId = specialty ? String(specialty.id) : '';
  if (bookingState.specialtyId !== specialtyId) {
    availabilityRequestId += 1;
    bookingState.specialtyId = specialtyId;
    bookingState.specialtyName = specialty?.name || '';
    bookingState.doctorId = '';
    bookingState.doctorName = '';
    bookingState.room = '';
    bookingState.date = '';
    bookingState.timeSlot = '';
    bookingState.availableDates = [];
    bookingState.availableSlots = [];
    bookingState.datesLoading = false;
    bookingState.slotsLoading = false;
    bookingState.slotConflictNotice = '';
    bookingState.scheduleSource = '';
    bookingState.availabilityRequiresDoctorChange = false;
    bookingState.bookingRequestKey = '';
  }
  const nextButton = document.getElementById('bookingNextButton');
  if (nextButton) nextButton.disabled = !specialty;
}

function updateBookingDoctorButton(value) {
  const nextButton = document.getElementById('bookingNextButton');
  if (nextButton) nextButton.disabled = !value;
}

function updateBookingDate(value) {
  if (!bookingState.availableDates.includes(value) ||
      value < bookingState.bookingWindowStart ||
      new Date(`${value}T00:00:00.000Z`).getUTCDay() === 0) return;
  if (bookingState.date !== value) {
    availabilityRequestId += 1;
    bookingState.date = value;
    bookingState.timeSlot = '';
    bookingState.availableSlots = [];
    bookingState.slotsLoading = false;
    bookingState.slotConflictNotice = '';
    bookingState.bookingRequestKey = '';
  }
  renderBookingStep();
}

function selectBookingShift(shift) {
  if (!['morning', 'afternoon'].includes(shift) || bookingState.selectedShift === shift) return;
  bookingState.selectedShift = shift;
  if (bookingState.timeSlot && getSlotShift(bookingState.timeSlot) !== shift) {
    bookingState.timeSlot = '';
    bookingState.bookingRequestKey = '';
  }
  renderBookingStep();
}

function goToStep(step) {
  if (step >= bookingState.step || step < 1) return;
  if (bookingState.step === 5) saveBookingForm();
  bookingState.step = step;
  bookingState.availabilityError = '';
  renderBookingStep();
  if (step === 3) loadAvailableDates();
  if (step === 4) loadAvailableSlots();
}

function saveBookingForm() {
  const formValues = {
    patientName: document.getElementById('bkName')?.value.trim() || '',
    patientPhone: document.getElementById('bkPhone')?.value.trim() || '',
    patientEmail: document.getElementById('bkEmail')?.value.trim() || '',
    patientGender: document.getElementById('bkGender')?.value || '',
    notes: document.getElementById('bkNotes')?.value.trim() || ''
  };
  if (Object.entries(formValues).some(([key, value]) => bookingState[key] !== value)) {
    bookingState.bookingRequestKey = '';
  }
  Object.assign(bookingState, formValues);
}

function clearBookingFieldError(fieldId) {
  const field = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}Error`);
  if (!field || !error) return;
  field.setCustomValidity('');
  field.setAttribute('aria-invalid', 'false');
  error.textContent = '';
  error.hidden = true;
}

function setBookingFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}Error`);
  if (!field || !error) return false;
  field.setCustomValidity(message);
  field.setAttribute('aria-invalid', 'true');
  error.textContent = message;
  error.hidden = false;
  return false;
}

function validateBookingForm() {
  const fields = ['bkName', 'bkPhone', 'bkEmail', 'bkGender', 'bkNotes']
    .map(id => document.getElementById(id));
  fields.forEach(field => clearBookingFieldError(field.id));
  const [name, phone, email, gender, reason] = fields;

  if (!name.value.trim()) return setBookingFieldError(name.id, 'Vui lòng nhập họ và tên.');
  if (name.value.trim().length > 100) return setBookingFieldError(name.id, 'Họ và tên không được vượt quá 100 ký tự.');
  if (!/^(0|\+84)[0-9]{8,10}$/.test(phone.value.trim())) return setBookingFieldError(phone.id, 'Nhập số điện thoại Việt Nam gồm 9–11 chữ số, bắt đầu bằng 0 hoặc +84.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return setBookingFieldError(email.id, 'Vui lòng nhập địa chỉ email hợp lệ.');
  if (!gender.value) return setBookingFieldError(gender.id, 'Vui lòng chọn giới tính.');
  if (!reason.value.trim()) return setBookingFieldError(reason.id, 'Vui lòng nhập lý do khám hoặc triệu chứng.');
  if (reason.value.trim().length > 2000) return setBookingFieldError(reason.id, 'Lý do khám không được vượt quá 2000 ký tự.');
  return true;
}

function nextStep1() {
  const specialtyId = document.getElementById('stepSpecSelect')?.value || '';
  if (!systemSpecialties.some(item => String(item.id) === specialtyId)) return;
  updateBookingSpecialty(specialtyId);
  bookingState.step = 2;
  renderBookingStep();
}

function nextStep2() {
  const select = document.getElementById('stepDocSelect');
  if (!select?.value) return;
  const doctor = systemDoctors.find(item => String(item.id) === select.value);
  if (!doctor || !doctor.bookingAvailable || Number(doctor.specialty_id) !== Number(bookingState.specialtyId)) {
    bookingState.availabilityError = 'Không tìm thấy bác sĩ phù hợp với chuyên khoa đã chọn. Vui lòng chọn lại.';
    renderBookingStep();
    return;
  }
  const changedDoctor = String(bookingState.doctorId) !== String(doctor.id);
  if (changedDoctor) availabilityRequestId += 1;
  bookingState.doctorId = String(doctor.id);
  bookingState.doctorName = doctor.full_name;
  bookingState.room = doctor.room;
  if (changedDoctor) {
    bookingState.date = '';
    bookingState.timeSlot = '';
    bookingState.availableDates = [];
    bookingState.availableSlots = [];
    bookingState.datesLoading = false;
    bookingState.slotsLoading = false;
    bookingState.scheduleSource = '';
    bookingState.availabilityRequiresDoctorChange = false;
  }
  bookingState.step = 3;
  bookingState.availabilityError = '';
  renderBookingStep();
  loadAvailableDates();
}

async function loadAvailableDates() {
  const doctorId = bookingState.doctorId;
  if (!doctorId || bookingState.step !== 3) return;
  const requestId = ++availabilityRequestId;
  const doctor = getBookingDoctor();
  if (!doctor || !doctor.bookingAvailable) {
    bookingState.availableDates = [];
    bookingState.date = '';
    bookingState.timeSlot = '';
    bookingState.availableSlots = [];
    bookingState.datesLoading = false;
    bookingState.slotsLoading = false;
    bookingState.availabilityRequiresDoctorChange = true;
    bookingState.availabilityError = 'Không tìm thấy bác sĩ đang hoạt động. Vui lòng chọn bác sĩ khác.';
    renderBookingStep();
    return;
  }
  bookingState.datesLoading = true;
  bookingState.availabilityError = '';
  bookingState.availabilityRequiresDoctorChange = false;
  renderBookingStep();
  try {
    const response = await apiRequest(`/public/doctors/${encodeURIComponent(doctorId)}/dates`);
    if (requestId !== availabilityRequestId || doctorId !== bookingState.doctorId) return;
    if (!response || response.success === false) {
      throw new Error(response?.message || 'Phản hồi lịch khám không hợp lệ.');
    }
    const dates = Array.isArray(response.data) ? response.data.map(date => String(date).slice(0, 10)) : [];
    bookingState.availableDates = dates;
    bookingState.bookingWindowStart = String(response.booking_window_start || dates[0] || '').slice(0, 10);
    bookingState.bookingWindowEnd = String(response.booking_window_end || '').slice(0, 10);
    if (!bookingState.viewedMonth && bookingState.bookingWindowStart) {
      bookingState.viewedMonth = getClinicMonth(bookingState.bookingWindowStart);
    }
    bookingState.scheduleSource = response.schedule_source || '';
    if (!dates.includes(bookingState.date)) {
      bookingState.date = '';
      bookingState.timeSlot = '';
      bookingState.availableSlots = [];
      bookingState.bookingRequestKey = '';
    }
    if (!dates.length) bookingState.availabilityError = 'Bác sĩ hiện chưa có ngày khám khả dụng. Vui lòng chọn bác sĩ khác.';
  } catch (error) {
    if (requestId !== availabilityRequestId) return;
    bookingState.availableDates = [];
    bookingState.date = '';
    bookingState.bookingWindowStart = '';
    bookingState.bookingWindowEnd = '';
    bookingState.viewedMonth = '';
    bookingState.timeSlot = '';
    bookingState.availableSlots = [];
    bookingState.availabilityError = 'Không thể tải ngày khám từ lịch trực. Vui lòng thử lại.';
    bookingState.availabilityRequiresDoctorChange = false;
    console.error('Không thể tải ngày khám:', error.message);
  } finally {
    if (requestId === availabilityRequestId) {
      bookingState.datesLoading = false;
      renderBookingStep();
    }
  }
}

function nextStep3() {
  if (bookingState.datesLoading || !bookingState.date ||
      !bookingState.availableDates.includes(bookingState.date) ||
      new Date(`${bookingState.date}T00:00:00.000Z`).getUTCDay() === 0) return;
  bookingState.step = 4;
  bookingState.availabilityError = '';
  renderBookingStep();
  loadAvailableSlots();
}

async function loadAvailableSlots() {
  const doctorId = bookingState.doctorId;
  const date = bookingState.date;
  if (!doctorId || !date || bookingState.step !== 4) return;
  const requestId = ++availabilityRequestId;
  bookingState.slotsLoading = true;
  bookingState.availabilityError = '';
  renderBookingStep();
  try {
    const response = await apiRequest(`/public/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`);
    if (requestId !== availabilityRequestId || doctorId !== bookingState.doctorId || date !== bookingState.date) return;
    if (!response || response.success === false) {
      throw new Error(response?.message || 'Phản hồi khung giờ không hợp lệ.');
    }
    bookingState.availableSlots = Array.isArray(response.data) ? response.data : [];
    bookingState.scheduleSource = response.schedule_source || bookingState.scheduleSource;
    if (!bookingState.availableSlots.some(slot => slot.slot_time === bookingState.timeSlot && !slot.is_booked)) {
      bookingState.timeSlot = '';
    }
    if (!bookingState.availableSlots.some(slot => !slot.is_booked)) {
      bookingState.availabilityError = 'Không còn khung giờ trống trong ngày đã chọn. Vui lòng chọn ngày khác.';
    }
  } catch (error) {
    if (requestId !== availabilityRequestId) return;
    bookingState.availableSlots = [];
    bookingState.timeSlot = '';
    bookingState.availabilityError = 'Không thể tải khung giờ từ lịch trực. Vui lòng thử lại.';
    console.error('Không thể tải khung giờ:', error.message);
  } finally {
    if (requestId === availabilityRequestId) {
      bookingState.slotsLoading = false;
      renderBookingStep();
    }
  }
}

function pickSlot(slotTime) {
  const slot = bookingState.availableSlots.find(item => item.slot_time === slotTime && !item.is_booked);
  if (!slot) return;
  bookingState.timeSlot = slot.slot_time;
  bookingState.bookingRequestKey = '';
  bookingState.slotConflictNotice = '';
  renderBookingStep();
}

function nextStep4() {
  if (bookingState.slotsLoading || !bookingState.timeSlot || !bookingState.availableSlots.some(slot => slot.slot_time === bookingState.timeSlot && !slot.is_booked)) return;
  bookingState.step = 5;
  renderBookingStep();
}

async function submitAppointment(event) {
  event.preventDefault();
  if (bookingState.submitting) return;
  saveBookingForm();
  const form = event.currentTarget;
  if (!validateBookingForm() || !form.reportValidity()) return;

  const doctor = getBookingDoctor();
  if (!doctor || !bookingState.date || !bookingState.timeSlot) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const status = document.getElementById('bookingSubmitStatus');
  if (!bookingState.bookingRequestKey) {
    bookingState.bookingRequestKey = crypto.randomUUID
      ? crypto.randomUUID()
      : [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  bookingState.submitting = true;
  submitButton.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  status.textContent = 'Đang gửi yêu cầu đặt lịch...';
  status.setAttribute('role', 'status');
  try {
    const response = await apiRequest('/public/appointments', {
      method: 'POST',
      body: JSON.stringify({
        specialty_id: doctor.specialty_id,
        doctor_id: doctor.id,
        appointment_date: bookingState.date,
        slot_time: bookingState.timeSlot,
        patient_name: bookingState.patientName,
        patient_phone: bookingState.patientPhone,
        patient_email: bookingState.patientEmail,
        patient_gender: bookingState.patientGender,
        reason: bookingState.notes,
        idempotency_key: bookingState.bookingRequestKey
      })
    });
    const appointment = response.data;
    if (!response.success || !appointment?.appointment_code) {
      throw new Error('Máy chủ chưa xác nhận yêu cầu đặt lịch.');
    }

    document.getElementById('confCode').textContent = appointment.appointment_code;
    document.getElementById('confName').textContent = appointment.patient_name;
    document.getElementById('confSpec').textContent = appointment.specialty_name;
    document.getElementById('confDoc').textContent = appointment.doctor_display || `${appointment.doctor_degree} ${appointment.doctor_name}`;
    document.getElementById('confDate').textContent = formatClinicDate(appointment.appointment_date);
    document.getElementById('confTime').textContent = `${String(appointment.slot_time).slice(0, 5)} - ${String(appointment.end_time).slice(0, 5)}`;
    document.getElementById('confRoom').textContent = appointment.room_number;
    document.getElementById('confStatus').textContent = appointment.status === 'pending'
      ? 'Chờ duyệt — chưa phải lịch khám chính thức'
      : appointment.status === 'confirmed' ? 'Đã xác nhận' : appointment.status;
    const emailStatus = document.getElementById('confEmailStatus');
    const emailStatusMessages = {
      sent: 'Email thông báo đã được máy chủ thư chấp nhận.',
      queued: 'Email thông báo đang chờ gửi; hệ thống chưa xác nhận đã gửi.',
      retry: 'Email chưa gửi được; hệ thống sẽ tự thử lại.',
      sending: 'Email thông báo đang được gửi.',
      unknown: 'Chưa xác định được trạng thái email thông báo.'
    };
    if (emailStatus) {
      emailStatus.textContent = emailStatusMessages[appointment.email_status || appointment.email_delivery_status] || emailStatusMessages.unknown;
    }
    resetBookingState();
    renderBookingStep();
    switchView('confirm');
  } catch (error) {
    if (error.code === 'APPOINTMENT_SLOT_TAKEN') {
      bookingState.submitting = false;
      bookingState.bookingRequestKey = '';
      bookingState.timeSlot = '';
      bookingState.availableSlots = [];
      bookingState.slotConflictNotice = error.message || 'Khung giờ này vừa có người đặt, vui lòng chọn khung giờ khác.';
      bookingState.step = 4;
      bookingState.availabilityError = '';
      renderBookingStep();
      await loadAvailableSlots();
      return;
    }
    status.textContent = error.message || 'Không thể gửi yêu cầu đặt lịch. Vui lòng thử lại.';
    status.setAttribute('role', 'alert');
    console.error('Gửi yêu cầu đặt lịch thất bại:', error.message);
    bookingState.submitting = false;
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
  }
}

function setLookupMessage(message, type = 'error') {
  const box = document.getElementById('homeLookupResult');
  if (!box) return;
  box.innerHTML = `<p class="lookup-message ${type === 'error' ? 'lookup-error' : ''}" role="${type === 'error' ? 'alert' : 'status'}">${escapePatientMarkup(message)}</p>`;
}

function appointmentStatus(status) {
  const values = {
    pending: { label: 'Chờ duyệt', className: 'badge-pending' },
    confirmed: { label: 'Đã xác nhận', className: 'badge-confirmed' },
    completed: { label: 'Đã hoàn tất', className: 'badge-completed' },
    cancelled: { label: 'Đã hủy', className: 'badge-cancelled' },
    rejected: { label: 'Bị từ chối', className: 'badge-cancelled' },
    expired: { label: 'Hết hạn', className: 'badge-cancelled' }
  };
  return values[status] || { label: 'Đang cập nhật', className: 'badge-pending' };
}

function renderAppointmentResult(appointment) {
  verifiedAppointment = appointment;
  const status = appointmentStatus(appointment.status);
  const room = appointment.room_number || '';
  const endTime = appointment.end_time ? ` - ${String(appointment.end_time).slice(0, 5)}` : '';
  const doctorName = appointment.doctor_display || `${appointment.doctor_degree || ''} ${appointment.doctor_name || ''}`.trim();
  const canCancel = ['pending', 'confirmed'].includes(appointment.status);
  const box = document.getElementById('homeLookupResult');
  box.innerHTML = `
    <article class="lookup-appointment-result">
      <div class="lookup-result-heading">
        <strong>Mã lịch hẹn: ${escapePatientMarkup(appointment.appointment_code)}</strong>
        <span class="status-badge ${status.className}">${status.label}</span>
      </div>
      <dl class="lookup-result-details">
        <div><dt>Bệnh nhân</dt><dd>${escapePatientMarkup(appointment.patient_name)}</dd></div>
        <div><dt>Bác sĩ</dt><dd>${escapePatientMarkup(doctorName)}</dd></div>
        <div><dt>Chuyên khoa</dt><dd>${escapePatientMarkup(appointment.specialty_name)}</dd></div>
        <div><dt>Ngày, giờ khám</dt><dd>${escapePatientMarkup(formatClinicDate(appointment.appointment_date))} · ${escapePatientMarkup(String(appointment.slot_time).slice(0, 5) + endTime)}</dd></div>
        ${room ? `<div><dt>Phòng khám</dt><dd>${escapePatientMarkup(room)}</dd></div>` : ''}
      </dl>
      ${canCancel ? '<button type="button" class="btn btn-danger" id="cancelAppointmentButton"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Hủy lịch hẹn</button>' : ''}
    </article>
  `;
}

async function lookupAppointment() {
  const codeInput = document.getElementById('homeLookupCode');
  const contactInput = document.getElementById('homeLookupContact');
  const code = codeInput.value.trim();
  const contact = contactInput.value.trim();
  verifiedAppointment = null;

  codeInput.removeAttribute('aria-invalid');
  contactInput.removeAttribute('aria-invalid');
  if (!code || !contact) {
    if (!code) codeInput.setAttribute('aria-invalid', 'true');
    if (!contact) contactInput.setAttribute('aria-invalid', 'true');
    setLookupMessage('Vui lòng nhập mã lịch hẹn và số điện thoại hoặc email đã dùng khi đặt lịch.');
    (!code ? codeInput : contactInput).focus();
    return;
  }

  const button = document.getElementById('homeLookupSubmit');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  setLookupMessage('Đang tra cứu lịch hẹn...', 'status');
  try {
    const response = await apiRequest('/public/appointments/lookup', {
      method: 'POST',
      body: JSON.stringify({ appointment_code: code, verifier: contact })
    });
    if (!response.success || !response.data) {
      setLookupMessage('Không tìm thấy lịch hẹn phù hợp hoặc thông tin chưa chính xác.');
      return;
    }
    renderAppointmentResult(response.data);
  } catch (error) {
    const message = error.status === 404 || error.status === 400
      ? 'Không tìm thấy lịch hẹn phù hợp hoặc thông tin chưa chính xác.'
      : 'Không thể kết nối để tra cứu lúc này. Vui lòng thử lại.';
    setLookupMessage(message);
    if (error.status !== 404 && error.status !== 400) {
      console.error('Tra cứu lịch hẹn thất bại:', error.message);
    }
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function cancelAppt() {
  if (!verifiedAppointment) return;
  const appointmentDoctor = verifiedAppointment.doctor_display ||
    `${verifiedAppointment.doctor_degree || ''} ${verifiedAppointment.doctor_name || ''}`.trim();
  const appointmentTime = `${String(verifiedAppointment.slot_time).slice(0, 5)}${verifiedAppointment.end_time ? ` - ${String(verifiedAppointment.end_time).slice(0, 5)}` : ''}`;
  const confirmed = window.confirm(
    `Bạn có chắc chắn muốn hủy lịch hẹn ${verifiedAppointment.appointment_code}?\n` +
    `Bác sĩ: ${appointmentDoctor}\n` +
    `Thời gian: ${formatClinicDate(verifiedAppointment.appointment_date)} · ${appointmentTime}`
  );
  if (!confirmed) return;

  const button = document.getElementById('cancelAppointmentButton');
  if (button) button.disabled = true;
  setLookupMessage('Đang gửi yêu cầu hủy lịch hẹn...', 'status');
  try {
    const response = await apiRequest('/public/appointments/cancel', {
      method: 'POST',
      body: JSON.stringify({
        appointment_code: verifiedAppointment.appointment_code,
        verifier: document.getElementById('homeLookupContact').value.trim()
      })
    });
    if (!response.success) throw new Error(response.message || 'Máy chủ chưa xác nhận hủy lịch.');
    setLookupMessage(response.message || 'Yêu cầu hủy lịch đã được xác nhận.', 'status');
    await lookupAppointment();
  } catch (error) {
    setLookupMessage(error.message || 'Không thể hủy lịch lúc này. Lịch hẹn chưa được cập nhật.');
    console.error('Hủy lịch hẹn thất bại:', error.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderBookingStep();
  document.getElementById('homeLookupForm')?.addEventListener('submit', event => {
    event.preventDefault();
    lookupAppointment();
  });
  document.getElementById('homeLookupResult')?.addEventListener('click', event => {
    if (event.target.closest('#cancelAppointmentButton')) cancelAppt();
  });
});
