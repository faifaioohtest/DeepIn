let currentUser = null;
let isRegisterMode = false;
let nextCursor = null;
let hasMorePosts = true;
let isLoadingPosts = false;
let observer = null;
let currentWorkFilter = ''; // 當前選定的業務/主題篩選

// --- 1. DOM 元素選取 ---
const authNav = document.getElementById('authNav');
const composeCard = document.getElementById('composeCard');
const postContent = document.getElementById('postContent');
const charCount = document.getElementById('charCount');
const submitBtn = document.getElementById('submitBtn');
const timeline = document.getElementById('timeline');
const infiniteScrollSentinel = document.getElementById('infiniteScrollSentinel');
const loadingSpinner = document.getElementById('loadingSpinner');
const noMoreMsg = document.getElementById('noMoreMsg');

// 登入 / 註冊 彈窗
const authModal = document.getElementById('authModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const formTitle = document.getElementById('formTitle');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authPrimaryBtn = document.getElementById('authPrimaryBtn');
const toggleAuthBtn = document.getElementById('toggleAuthBtn');
const authError = document.getElementById('authError');

// 修改密碼 彈窗
const pwdModal = document.getElementById('pwdModal');
const closePwdModalBtn = document.getElementById('closePwdModalBtn');
const currentPwdInput = document.getElementById('currentPwdInput');
const newPwdInput = document.getElementById('newPwdInput');
const confirmPwdInput = document.getElementById('confirmPwdInput');
const submitPwdBtn = document.getElementById('submitPwdBtn');
const pwdError = document.getElementById('pwdError');

// 上傳頭像 彈窗
const avatarModal = document.getElementById('avatarModal');
const closeAvatarModalBtn = document.getElementById('closeAvatarModalBtn');
const avatarFileInput = document.getElementById('avatarFileInput');
const avatarPreview = document.getElementById('avatarPreview');
const submitAvatarBtn = document.getElementById('submitAvatarBtn');
const avatarError = document.getElementById('avatarError');

// --- 2. 輔助渲染函式 (職場專業頭像 & 標籤解析) ---
function renderAvatarHtml(username, avatarUrl, sizeClass = 'avatar-circle') {
  if (avatarUrl) {
    return `<div class="${sizeClass}"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}"></div>`;
  }
  const initial = (username || '?').trim().charAt(0).toUpperCase();
  return `<div class="${sizeClass}"><span>${escapeHtml(initial)}</span></div>`;
}

// 解析職場專業動態標籤：[範疇: ...]、[心得: ...]、#Hashtag
function formatWorkPostContent(rawContent) {
  let safeText = escapeHtml(rawContent);
  const badges = [];

  // 1. 解析 [範疇: xxx]
  safeText = safeText.replace(/\[範疇:\s*([^\]]+)\]/g, (_, category) => {
    const trimmed = category.trim();
    badges.push(`<span class="work-badge category-badge clickable-category-badge" data-filter-target="${trimmed}" title="點擊篩選此專業範疇">💼 ${trimmed}</span>`);
    return '';
  });

  // 2. 解析 [心得: xxx]
  safeText = safeText.replace(/\[心得:\s*([^\]]+)\]/g, (_, insight) => {
    badges.push(`<div class="insight-summary-bar"><strong>💡 專業心得：</strong> ${insight.trim()}</div>`);
    return '';
  });

  // 3. 高亮 #Hashtag 標籤
  safeText = safeText.replace(/#([\w\u4e00-\u9fa5]+)/g, '<span class="post-hashtag">#$1</span>');

  const badgesHtml = badges.length > 0 
    ? `<div class="work-meta-container">${badges.join('')}</div>` 
    : '';

  return `${badgesHtml}<p class="post-body-text">${safeText.trim()}</p>`;
}

// --- 3. 即時時鐘與香港天文台天氣 ---
function startClock() {
  const timeEl = document.getElementById('currentTime');
  const dateEl = document.getElementById('currentDate');

  function update() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-HK', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const dateStr = now.toLocaleDateString('zh-HK', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
  }

  update();
  setInterval(update, 1000);
}

async function fetchHKWeather() {
  const tempEl = document.getElementById('weatherTemp');
  const humidityEl = document.getElementById('weatherHumidity');
  const uvEl = document.getElementById('weatherUV');

  try {
    const res = await fetch('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc');
    const data = await res.json();

    if (data.temperature?.data?.length > 0) {
      const hkoTemp = data.temperature.data.find(d => d.place === '香港天文台') || data.temperature.data[0];
      if (tempEl) tempEl.textContent = `${hkoTemp.value}°C`;
    }

    if (data.humidity?.data?.length > 0) {
      const humidityVal = data.humidity.data[0].value;
      if (humidityEl) humidityEl.textContent = `濕度 ${humidityVal}%`;
    }

    if (data.uvindex?.data?.length > 0 && uvEl) {
      const uvVal = data.uvindex.data[0].value;
      const uvDesc = data.uvindex.data[0].desc || '';
      uvEl.textContent = `☀️ UV ${uvVal} (${uvDesc})`;
      uvEl.classList.remove('hidden');
    } else if (uvEl) {
      uvEl.classList.add('hidden');
    }
  } catch (err) {
    if (tempEl) tempEl.textContent = '--°C';
    if (humidityEl) humidityEl.textContent = '天氣暫無資料';
  }
}

// --- 4. 登入 / 註冊 彈窗邏輯 ---
function openAuthModal(mode = 'login') {
  isRegisterMode = mode === 'register';
  updateAuthModalTexts();
  authUsername.value = '';
  authPassword.value = '';
  if (authError) authError.textContent = '';
  authModal.classList.remove('hidden');
  setTimeout(() => authUsername.focus(), 100);
}

function closeAuthModal() {
  authModal.classList.add('hidden');
}

function updateAuthModalTexts() {
  formTitle.textContent = isRegisterMode ? '建立專業檔案' : '登入職場帳號';
  authPrimaryBtn.textContent = isRegisterMode ? '註冊加入' : '登入';
  toggleAuthBtn.textContent = isRegisterMode ? '已有帳號？切換登入' : '切換至註冊';
}

if (closeModalBtn) closeModalBtn.addEventListener('click', closeAuthModal);

if (authModal) {
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
  });
}

if (toggleAuthBtn) {
  toggleAuthBtn.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    updateAuthModalTexts();
    if (authError) authError.textContent = '';
  });
}

if (authPrimaryBtn) {
  authPrimaryBtn.addEventListener('click', async () => {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    if (authError) authError.textContent = '';

    if (!username || !password) {
      if (authError) authError.textContent = '請填寫用戶名及密碼';
      return;
    }

    const action = isRegisterMode ? 'register' : 'login';
    try {
      const res = await fetch(`/api/auth.php?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (res.ok) {
        closeAuthModal();
        await checkAuth();
        loadPosts();
      } else {
        if (authError) authError.textContent = data.error || '驗證失敗';
      }
    } catch (e) {
      if (authError) authError.textContent = '網路異常，請稍後重試';
    }
  });
}

// --- 5. 修改密碼 彈窗邏輯 ---
function openPwdModal() {
  currentPwdInput.value = '';
  newPwdInput.value = '';
  confirmPwdInput.value = '';
  if (pwdError) pwdError.textContent = '';
  pwdModal.classList.remove('hidden');
  setTimeout(() => currentPwdInput.focus(), 100);
}

function closePwdModal() {
  pwdModal.classList.add('hidden');
}

if (closePwdModalBtn) closePwdModalBtn.addEventListener('click', closePwdModal);

if (pwdModal) {
  pwdModal.addEventListener('click', (e) => {
    if (e.target === pwdModal) closePwdModal();
  });
}

if (submitPwdBtn) {
  submitPwdBtn.addEventListener('click', async () => {
    const currentPassword = currentPwdInput.value;
    const newPassword = newPwdInput.value;
    const confirmPassword = confirmPwdInput.value;
    if (pwdError) pwdError.textContent = '';

    if (!currentPassword || !newPassword || !confirmPassword) {
      pwdError.textContent = '請填寫所有欄位';
      return;
    }

    if (newPassword.length < 6) {
      pwdError.textContent = '新密碼長度至少需 6 碼';
      return;
    }

    if (newPassword !== confirmPassword) {
      pwdError.textContent = '兩次輸入的新密碼不一致';
      return;
    }

    try {
      const res = await fetch('/api/auth.php?action=change_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      const data = await res.json();

      if (res.ok) {
        alert('密碼修改成功！');
        closePwdModal();
      } else {
        pwdError.textContent = data.error || '密碼更新失敗';
      }
    } catch (e) {
      pwdError.textContent = '網路異常，請稍後重試';
    }
  });
}

// --- 6. 上傳頭像 彈窗邏輯 ---
function openAvatarModal() {
  if (avatarFileInput) avatarFileInput.value = '';
  if (avatarError) avatarError.textContent = '';
  if (avatarPreview && currentUser) {
    avatarPreview.innerHTML = currentUser.avatar 
      ? `<img src="${escapeHtml(currentUser.avatar)}" alt="${escapeHtml(currentUser.username)}">`
      : `<span>${escapeHtml(currentUser.username.charAt(0).toUpperCase())}</span>`;
  }
  avatarModal.classList.remove('hidden');
}

function closeAvatarModal() {
  avatarModal.classList.add('hidden');
}

if (closeAvatarModalBtn) closeAvatarModalBtn.addEventListener('click', closeAvatarModal);

if (avatarModal) {
  avatarModal.addEventListener('click', (e) => {
    if (e.target === avatarModal) closeAvatarModal();
  });
}

if (avatarFileInput) {
  avatarFileInput.addEventListener('change', () => {
    const file = avatarFileInput.files[0];
    if (file && avatarPreview) {
      const reader = new FileReader();
      reader.onload = (e) => {
        avatarPreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
      };
      reader.readAsDataURL(file);
    }
  });
}

if (submitAvatarBtn) {
  submitAvatarBtn.addEventListener('click', async () => {
    const file = avatarFileInput.files[0];
    if (!file) {
      if (avatarError) avatarError.textContent = '請選擇圖片檔案';
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    submitAvatarBtn.disabled = true;
    submitAvatarBtn.textContent = '上傳中...';

    try {
      const res = await fetch('/api/auth.php?action=upload_avatar', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (res.ok && data.success) {
        closeAvatarModal();
        await checkAuth();
        loadPosts();
      } else {
        if (avatarError) avatarError.textContent = data.error || '上傳失敗';
      }
    } catch (e) {
      if (avatarError) avatarError.textContent = '網路異常，上傳失敗';
    } finally {
      submitAvatarBtn.disabled = false;
      submitAvatarBtn.textContent = '更新頭像';
    }
  });
}

// --- 7. 身份狀態與「帳戶」下拉功能表 ---
async function checkAuth() {
  try {
    const res = await fetch('/api/auth.php?action=me');
    const data = await res.json();
    currentUser = data.authenticated ? data.user : null;
  } catch (err) {
    currentUser = null;
  }
  renderUI();
}

function renderUI() {
  if (currentUser) {
    authNav.innerHTML = `
      <div class="user-menu-container">
        <button id="userMenuBtn" class="user-menu-trigger" type="button">
          ${renderAvatarHtml(currentUser.username, currentUser.avatar, 'avatar-circle-sm')}
          <span>@${escapeHtml(currentUser.username)}</span>
          <span class="menu-arrow">▼</span>
        </button>

        <div id="userDropdown" class="user-menu-dropdown hidden">
          <button id="menuAvatarBtn" class="menu-item" type="button">
            <span>🖼️</span> 更換形象照
          </button>
          <button id="menuPwdBtn" class="menu-item" type="button">
            <span>🔑</span> 修改密碼
          </button>
          <div class="menu-divider"></div>
          <button id="menuLogoutBtn" class="menu-item danger-item" type="button">
            <span>🚪</span> 登出帳號
          </button>
        </div>
      </div>
    `;

    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');

    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('hidden');
    });

    document.getElementById('menuAvatarBtn').addEventListener('click', () => {
      userDropdown.classList.add('hidden');
      openAvatarModal();
    });

    document.getElementById('menuPwdBtn').addEventListener('click', () => {
      userDropdown.classList.add('hidden');
      openPwdModal();
    });

    document.getElementById('menuLogoutBtn').addEventListener('click', () => {
      userDropdown.classList.add('hidden');
      handleLogout();
    });

    if (composeCard) composeCard.classList.remove('hidden');
  } else {
    authNav.innerHTML = `<button id="headerLoginBtn" class="btn-login-trigger">登入 / 註冊</button>`;
    document.getElementById('headerLoginBtn').addEventListener('click', () => openAuthModal('login'));
    if (composeCard) composeCard.classList.add('hidden');
  }
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('userDropdown');
  const trigger = document.getElementById('userMenuBtn');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!dropdown.contains(e.target) && !trigger?.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  }
});

async function handleLogout() {
  await fetch('/api/auth.php?action=logout', { method: 'POST' });
  currentUser = null;
  renderUI();
  loadPosts();
}

// --- 8. 快捷專業標籤插入與發佈 ---
document.querySelectorAll('.tag-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const textToInsert = btn.getAttribute('data-insert');
    if (!postContent) return;
    const start = postContent.selectionStart;
    const end = postContent.selectionEnd;
    const currentVal = postContent.value;
    
    if ((currentVal + textToInsert).length <= 280) {
      postContent.value = currentVal.substring(0, start) + textToInsert + currentVal.substring(end);
      charCount.textContent = `${postContent.value.length}/280`;
      postContent.focus();
      postContent.selectionStart = postContent.selectionEnd = start + textToInsert.length;
    }
  });
});

if (postContent) {
  postContent.addEventListener('input', () => {
    charCount.textContent = `${postContent.value.length}/280`;
  });
}

if (submitBtn) {
  submitBtn.addEventListener('click', async () => {
    const content = postContent.value.trim();
    if (!content) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '發佈中...';

    try {
      const res = await fetch('/api/posts.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const data = await res.json();

      if (res.ok && data.post) {
        postContent.value = '';
        charCount.textContent = '0/280';

        const matchesFilter = !currentWorkFilter || data.post.content.includes(currentWorkFilter);

        if (matchesFilter) {
          const postHtml = renderPostTemplate(data.post);
          timeline.insertAdjacentHTML('afterbegin', postHtml);

          const newPostEl = document.getElementById(`post-${data.post.id}`);
          if (newPostEl) {
            bindSinglePostEvents(newPostEl);
            newPostEl.classList.add('new-post-fade-in');
          }

          if (noMoreMsg && timeline.children.length > 0) {
            noMoreMsg.classList.add('hidden');
          }
        } else {
          alert(`動態已發佈！可切換至「全部動態」或對應專業分類查看。`);
        }
      } else {
        alert(data.error || '發佈失敗');
      }
    } catch (e) {
      alert('發佈失敗，請檢查網路連線');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '發佈動態';
    }
  });
}

// --- 9. 職場專業分類過濾 ---
function setWorkFilter(filterValue) {
  currentWorkFilter = filterValue || '';
  
  document.querySelectorAll('.filter-chip').forEach(chip => {
    const chipFilter = chip.getAttribute('data-filter') || '';
    if (chipFilter === currentWorkFilter) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });

  nextCursor = null;
  hasMorePosts = true;
  loadPosts(false);
}

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const filter = chip.getAttribute('data-filter') || '';
    setWorkFilter(filter);
  });
});

// --- 10. 載入動態牆 (游標分頁 + 搜尋 + 無限滾動) ---
async function loadPosts(append = false) {
  if (isLoadingPosts) return;
  isLoadingPosts = true;

  if (!append) {
    nextCursor = null;
    hasMorePosts = true;
    if (loadingSpinner) loadingSpinner.classList.add('hidden');
    if (noMoreMsg) noMoreMsg.classList.add('hidden');
  }

  try {
    const queryParam = currentWorkFilter ? `&query=${encodeURIComponent(currentWorkFilter)}` : '';
    const url = nextCursor 
      ? `/api/posts.php?before_id=${nextCursor}&limit=10${queryParam}`
      : `/api/posts.php?limit=10${queryParam}`;

    if (loadingSpinner && append) {
      loadingSpinner.classList.remove('hidden');
    }

    const res = await fetch(url);
    const data = await res.json();
    
    const posts = Array.isArray(data) ? data : (data.posts || []);
    hasMorePosts = Array.isArray(data) ? false : Boolean(data.has_more);
    nextCursor = Array.isArray(data) ? null : data.next_cursor;

    const postsHtml = posts.map(renderPostTemplate).join('');

    if (append) {
      timeline.insertAdjacentHTML('beforeend', postsHtml);
    } else {
      timeline.innerHTML = postsHtml;
    }

    bindPostEvents();

    if (!hasMorePosts) {
      if (observer && infiniteScrollSentinel) {
        observer.unobserve(infiniteScrollSentinel);
      }
      if (timeline.children.length > 0 && noMoreMsg) {
        noMoreMsg.classList.remove('hidden');
      }
    } else if (observer && infiniteScrollSentinel) {
      observer.observe(infiniteScrollSentinel);
    }
  } catch (err) {
    console.error('載入動態失敗:', err);
  } finally {
    isLoadingPosts = false;
    if (loadingSpinner) {
      loadingSpinner.classList.add('hidden');
    }
  }
}

// --- 11. 單一貼文卡片 HTML 模板 ---
function renderPostTemplate(p) {
  const isOwner = currentUser && Number(currentUser.id) === Number(p.user_id);
  const isLiked = Number(p.liked_by_me) === 1;
  const isEdited = Boolean(p.updated_at);

  return `
    <article class="post-card" id="post-${p.id}" data-id="${p.id}">
      <div class="post-header">
        <div class="post-author-box">
          ${renderAvatarHtml(p.username, p.avatar, 'avatar-circle')}
          <div class="author-title-group">
            <span class="author-name">@${escapeHtml(p.username)}</span>
            <span class="author-headline">COp Grade 專業同仁</span>
          </div>
        </div>
        <div class="post-time-meta">
          <time>${new Date(p.created_at).toLocaleString()}</time>
          ${isEdited ? `<span class="edited-tag" title="最後編輯於: ${new Date(p.updated_at).toLocaleString()}">(已編輯)</span>` : ''}
        </div>
      </div>
      
      <!-- 貼文內文 -->
      <div class="post-body" id="post-body-${p.id}">
        ${formatWorkPostContent(p.content)}
      </div>
      
      <!-- 編輯輸入區塊 -->
      <div class="edit-box hidden" id="edit-box-${p.id}">
        <textarea class="edit-textarea" id="edit-text-${p.id}" maxlength="280">${escapeHtml(p.content)}</textarea>
        <div class="edit-actions">
          <button class="save-edit-btn" data-id="${p.id}">儲存修改</button>
          <button class="cancel-edit-btn link-btn" data-id="${p.id}">取消</button>
        </div>
      </div>

      <div class="post-footer">
        <div class="post-social-actions">
          <button class="action-btn like-btn ${isLiked ? 'liked' : ''}" data-id="${p.id}">
            ${isLiked ? '👍 認同' : '👍 讚'} ${p.likes_count || 0}
          </button>
          <button class="action-btn comment-btn" data-id="${p.id}">
            💬 討論 <span id="comment-count-${p.id}">${p.comments_count || 0}</span>
          </button>
        </div>
        <div class="post-owner-actions">
          ${isOwner ? `
            <button class="action-btn edit-btn" data-id="${p.id}">編輯</button>
            <button class="action-btn delete-btn" data-id="${p.id}">刪除</button>
          ` : ''}
        </div>
      </div>

      <!-- 留言討論區塊 -->
      <div class="comments-section hidden" id="comments-section-${p.id}">
        <div class="comments-list" id="comments-list-${p.id}">
          <p class="comment-login-hint">載入討論中...</p>
        </div>
        <div id="comment-form-container-${p.id}">
          ${currentUser ? `
            <div class="comment-input-box">
              <input type="text" id="comment-input-${p.id}" placeholder="發表專業回覆或看法..." maxlength="280" />
              <button class="send-comment-btn" data-id="${p.id}">回覆</button>
            </div>
          ` : `
            <p class="comment-login-hint">登入後即可參與專業討論</p>
          `}
        </div>
      </div>
    </article>
  `;
}

// --- 12. 互動事件綁定 ---
function bindSinglePostEvents(card) {
  const postId = card.getAttribute('data-id');

  // 點擊專業範疇標籤快速篩選
  card.querySelectorAll('.clickable-category-badge').forEach(badge => {
    badge.onclick = (e) => {
      e.stopPropagation();
      const targetCategory = badge.getAttribute('data-filter-target');
      if (targetCategory) setWorkFilter(targetCategory);
    };
  });

  // 按讚 / 認同
  const likeBtn = card.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.onclick = async () => {
      if (!currentUser) {
        openAuthModal('login');
        return;
      }
      const res = await fetch('/api/posts.php?action=like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId })
      });
      const data = await res.json();
      if (res.ok) {
        const isLiked = data.action === 'liked';
        likeBtn.classList.toggle('liked', isLiked);
        let count = parseInt(likeBtn.textContent.replace(/[^0-9]/g, '')) || 0;
        count = isLiked ? count + 1 : Math.max(0, count - 1);
        likeBtn.innerHTML = `${isLiked ? '👍 認同' : '👍 讚'} ${count}`;
      }
    };
  }

  // 展開 / 收合討論
  const commentBtn = card.querySelector('.comment-btn');
  const commentsSection = card.querySelector(`#comments-section-${postId}`);
  const commentsList = card.querySelector(`#comments-list-${postId}`);

  if (commentBtn && commentsSection) {
    commentBtn.onclick = async () => {
      const isHidden = commentsSection.classList.contains('hidden');
      if (isHidden) {
        commentsSection.classList.remove('hidden');
        try {
          const res = await fetch(`/api/comments.php?post_id=${postId}`);
          const comments = await res.json();
          if (comments.length === 0) {
            commentsList.innerHTML = `<p class="comment-login-hint">尚無討論，搶先發表你的見解！</p>`;
          } else {
            commentsList.innerHTML = comments.map(c => `
              <div class="comment-item">
                <div class="comment-meta">
                  <div class="comment-author-box">
                    ${renderAvatarHtml(c.username, c.avatar, 'avatar-circle-sm')}
                    <strong>@${escapeHtml(c.username)}</strong>
                  </div>
                  <time>${new Date(c.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</time>
                </div>
                <div class="comment-text">${escapeHtml(c.content)}</div>
              </div>
            `).join('');
          }
        } catch (e) {
          commentsList.innerHTML = `<p class="comment-login-hint">載入討論失敗</p>`;
        }
      } else {
        commentsSection.classList.add('hidden');
      }
    };
  }

  // 發佈回覆
  const sendCommentBtn = card.querySelector('.send-comment-btn');
  if (sendCommentBtn) {
    sendCommentBtn.onclick = async () => {
      const inputEl = card.querySelector(`#comment-input-${postId}`);
      const content = inputEl.value.trim();
      if (!content) return;

      sendCommentBtn.disabled = true;
      try {
        const res = await fetch('/api/comments.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: postId, content })
        });
        const data = await res.json();

        if (res.ok && data.comment) {
          inputEl.value = '';
          const emptyHint = commentsList.querySelector('.comment-login-hint');
          if (emptyHint) emptyHint.remove();

          const commentHtml = `
            <div class="comment-item">
              <div class="comment-meta">
                <div class="comment-author-box">
                  ${renderAvatarHtml(data.comment.username, data.comment.avatar, 'avatar-circle-sm')}
                  <strong>@${escapeHtml(data.comment.username)}</strong>
                </div>
                <time>${new Date(data.comment.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</time>
              </div>
              <div class="comment-text">${escapeHtml(data.comment.content)}</div>
            </div>
          `;
          commentsList.insertAdjacentHTML('beforeend', commentHtml);

          const countEl = card.querySelector(`#comment-count-${postId}`);
          if (countEl) {
            countEl.textContent = parseInt(countEl.textContent || '0') + 1;
          }
        } else {
          alert(data.error || '回覆失敗');
        }
      } catch (e) {
        alert('網路異常，回覆失敗');
      } finally {
        sendCommentBtn.disabled = false;
      }
    };
  }

  // 刪除動態
  const deleteBtn = card.querySelector('.delete-btn');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm('確定要刪除這篇動態嗎？')) return;
      const res = await fetch(`/api/posts.php?id=${postId}`, { method: 'DELETE' });
      if (res.ok) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateY(-10px)';
        setTimeout(() => {
          card.remove();
          if (timeline.children.length === 0 && noMoreMsg) {
            noMoreMsg.classList.add('hidden');
          }
        }, 300);
      } else {
        const data = await res.json();
        alert(data.error || '刪除失敗');
      }
    };
  }

  // 編輯動態
  const editBtn = card.querySelector('.edit-btn');
  if (editBtn) {
    editBtn.onclick = () => {
      card.querySelector(`#post-body-${postId}`).classList.add('hidden');
      card.querySelector(`#edit-box-${postId}`).classList.remove('hidden');
    };
  }

  const cancelBtn = card.querySelector('.cancel-edit-btn');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      card.querySelector(`#post-body-${postId}`).classList.remove('hidden');
      card.querySelector(`#edit-box-${postId}`).classList.add('hidden');
    };
  }

  const saveBtn = card.querySelector('.save-edit-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const newContent = card.querySelector(`#edit-text-${postId}`).value.trim();
      if (!newContent) return alert('內容不可為空');

      const res = await fetch(`/api/posts.php?id=${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent })
      });

      if (res.ok) {
        const postBody = card.querySelector(`#post-body-${postId}`);
        postBody.innerHTML = formatWorkPostContent(newContent);
        postBody.classList.remove('hidden');
        card.querySelector(`#edit-box-${postId}`).classList.add('hidden');

        card.querySelectorAll('.clickable-category-badge').forEach(badge => {
          badge.onclick = (e) => {
            e.stopPropagation();
            const targetCategory = badge.getAttribute('data-filter-target');
            if (targetCategory) setWorkFilter(targetCategory);
          };
        });

        const timeMeta = card.querySelector('.post-time-meta');
        if (timeMeta && !card.querySelector('.edited-tag')) {
          timeMeta.insertAdjacentHTML('beforeend', '<span class="edited-tag">(已編輯)</span>');
        }
      } else {
        const data = await res.json();
        alert(data.error || '更新失敗');
      }
    };
  }
}

function bindPostEvents() {
  document.querySelectorAll('.post-card').forEach(card => {
    bindSinglePostEvents(card);
  });
}

// --- 13. 初始化 IntersectionObserver 無限滾動 ---
function setupInfiniteScroll() {
  if (!infiniteScrollSentinel) return;

  const options = {
    root: null,
    rootMargin: '200px',
    threshold: 0.1
  };

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && hasMorePosts && !isLoadingPosts && timeline.children.length > 0) {
        loadPosts(true);
      }
    });
  }, options);

  observer.observe(infiniteScrollSentinel);
}

// --- 14. 工具函式與初始化 ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

startClock();
fetchHKWeather();
setInterval(fetchHKWeather, 10 * 60 * 1000);

checkAuth();
loadPosts();
setupInfiniteScroll();