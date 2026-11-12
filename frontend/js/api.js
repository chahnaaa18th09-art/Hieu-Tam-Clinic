const API_BASE = (window.location.port === '5500' || window.location.protocol === 'file:')
  ? 'http://localhost:3000/api'
  : '/api';

const SPECIALTY_PRESENTATION = {
  1: { icon: 'fa-notes-medical', label: 'Nội Tổng Quát' },
  2: { icon: 'fa-heart-pulse', label: 'Tim Mạch' },
  3: { icon: 'fa-baby', label: 'Nhi Khoa' },
  4: { icon: 'fa-ear-listen', label: 'Tai – Mũi – Họng' },
  5: { icon: 'fa-hand-dots', label: 'Da Liễu' },
  6: { icon: 'fa-person-pregnant', label: 'Sản Phụ Khoa' },
  7: { icon: 'fa-bone', label: 'Cơ Xương Khớp' },
  8: { icon: 'fa-eye', label: 'Mắt' }
};

function createDoctorPlaceholder(name, background, gender, variant) {
  const initials = name.split(/\s+/).slice(-2).map(part => part[0]).join('');
  const femaleHair = [
    'M230 201c-10-89 23-145 90-145 75 0 103 64 88 146l-22 104H249Z',
    'M236 190c-7-83 28-132 83-132 68 0 96 53 89 139l-35 88H253Z',
    'M232 206c-4-91 29-148 88-148 71 0 103 58 86 149l-23 84H248Z',
    'M238 190c-3-78 28-132 84-132 62 0 100 48 89 133l-32 99H250Z'
  ];
  const maleHair = [
    'M238 165c0-68 33-106 82-106 55 0 86 40 84 103-24-20-46-27-70-27-32 0-60 13-96 30Z',
    'M239 158c5-62 35-99 81-99 52 0 81 37 83 92-26-16-49-23-76-20-29 2-55 12-88 27Z',
    'M237 166c0-65 35-107 87-107 48 0 80 37 83 100-23-13-43-20-67-20-37 0-64 12-103 27Z',
    'M240 160c4-63 35-101 82-101 54 0 83 40 81 96-20-16-43-24-68-22-35 1-64 12-95 27Z'
  ];
  const hair = (gender === 'female' ? femaleHair : maleHair)[Math.floor((variant - 1) / 2) % 4];
  const jacket = ['#d9f0e9', '#dceaf5', '#f4e3e9', '#e7ebd8', '#e9e1f4', '#f5ead7', '#dceef0', '#f0e4dc'][variant - 1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="${background}"/><circle cx="320" cy="170" r="82" fill="#f1c8ad"/><path d="${hair}" fill="#263c3a"/><path d="M125 480c8-126 76-191 195-191s187 65 195 191" fill="#fff"/><path d="m263 301 57 78 57-78 27 179H236Z" fill="${jacket}"/><path d="m286 329 34 47 34-47" fill="none" stroke="#148868" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="320" cy="415" r="35" fill="#fff"/><text x="320" y="426" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="#148868">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Lỗi kết nối API');
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

async function fetchSpecialtiesList() {
  const response = await apiRequest('/public/specialties');
  if (!Array.isArray(response.data)) throw new Error('Dữ liệu chuyên khoa không hợp lệ.');
  const specialties = response.data;
  return specialties.map(specialty => ({
    ...specialty,
    id: Number(specialty.id),
    doctor_count: Number(specialty.doctor_count) || 0
  }));
}

async function fetchDoctorsList() {
  const response = await apiRequest('/public/doctors');
  if (!Array.isArray(response.data)) throw new Error('Dữ liệu bác sĩ không hợp lệ.');
  const doctors = response.data;
  const backgrounds = ['#e3f5ef', '#e5f2f7', '#f7e9ed', '#e8eef8', '#edf2e5', '#f8efe2', '#e2f0f3', '#f3eafa'];

  return doctors.map(doctor => {
    const id = Number(doctor.id);
    const specialtyId = Number(doctor.specialty_id ?? doctor.specialtyId ?? doctor.specialty?.id ?? 0);
    const canonicalName = String(doctor.full_name || doctor.display_name || doctor.name || '').trim();
    const name = canonicalName || String(doctor.doctor_name || doctor.doctorDisplay || '').trim();
    const variant = Number.isInteger(id) && id > 0 ? ((id - 1) % backgrounds.length) + 1 : 1;
    return {
      ...doctor,
      id,
      specialty_id: specialtyId,
      name,
      full_name: doctor.display_name || [doctor.degree, name].filter(Boolean).join(' '),
      specialty_name: String(doctor.specialty_name || doctor.specialtyName || ''),
      room: String(doctor.room_number || doctor.room || ''),
      bio: String(doctor.bio || ''),
      experience_years: Number(doctor.experience_years) || 0,
      avatar: createDoctorPlaceholder(name, backgrounds[variant - 1], 'male', variant),
      bookingAvailable: Number.isInteger(id) && id > 0 && Number.isInteger(specialtyId) && specialtyId > 0
    };
  });
}