<?php
// 設定安全 Session Cookie 參數
session_set_cookie_params([
    'lifetime' => 86400 * 7, // 7 天
    'path'     => '/',
    'httponly' => true,      // 防範 XSS 竊取 Cookie
    'samesite' => 'Lax'
]);
session_start();

require_once 'config.php';

$action = $_GET['action'] ?? '';
$input  = json_decode(file_get_contents('php://input'), true) ?? [];

// 檢查當前登入狀態
// 在 action === 'me' 區塊中：
if ($action === 'me') {
    if (!isset($_SESSION['user_id'])) {
        echo json_encode(['authenticated' => false]);
        exit;
    }
    $stmt = $pdo->prepare("SELECT id, username, avatar FROM users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    echo json_encode(['authenticated' => true, 'user' => $user]);
    exit;
}

// 新增頭像上傳處理 (POST ?action=upload_avatar)
if ($action === 'upload_avatar' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(['error' => '請先登入']);
        exit;
    }

    if (!isset($_FILES['avatar']) || $_FILES['avatar']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['error' => '請選擇要上傳的圖片檔案']);
        exit;
    }

    $file = $_FILES['avatar'];

    // 限制 2MB 內
    if ($file['size'] > 2 * 1024 * 1024) {
        http_response_code(422);
        echo json_encode(['error' => '圖片檔案大小不得超過 2MB']);
        exit;
    }

    // 檢查 MIME 類型
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);
    $allowed = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp'
    ];

    if (!isset($allowed[$mimeType])) {
        http_response_code(422);
        echo json_encode(['error' => '僅支援 JPG, PNG 或 WEBP 圖片格式']);
        exit;
    }

    $ext = $allowed[$mimeType];
    $filename = 'avatar_' . $_SESSION['user_id'] . '_' . time() . '.' . $ext;
    $targetDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'avatars';
    if (!is_dir($targetDir)) {
        mkdir($targetDir, 0777, true);
    }
    $targetPath = $targetDir . DIRECTORY_SEPARATOR . $filename;

    if (move_uploaded_file($file['tmp_name'], $targetPath)) {
        $avatarUrl = '/uploads/avatars/' . $filename;

        // 更新資料庫
        $stmt = $pdo->prepare("UPDATE users SET avatar = ? WHERE id = ?");
        $stmt->execute([$avatarUrl, $_SESSION['user_id']]);

        echo json_encode(['success' => true, 'avatar' => $avatarUrl]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => '上傳檔案儲存失敗']);
    }
    exit;
}

// 註冊帳號
if ($action === 'register' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    if (mb_strlen($username) < 3 || mb_strlen($username) > 20) {
        http_response_code(422);
        echo json_encode(['error' => '用戶名長度需介於 3 至 20 字元']);
        exit;
    }

    if (strlen($password) < 6) {
        http_response_code(422);
        echo json_encode(['error' => '密碼長度至少需 6 碼']);
        exit;
    }

    // 檢查用戶名是否重複
    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        http_response_code(409);
        echo json_encode(['error' => '此用戶名已被註冊']);
        exit;
    }

    // 加密密碼並寫入 MariaDB
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
    $stmt->execute([$username, $hash]);

    $userId = $pdo->lastInsertId();
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['username'] = $username;

    echo json_encode(['success' => true, 'username' => $username]);
    exit;
}

// 登入
if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    $stmt = $pdo->prepare("SELECT id, username, password_hash FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        http_response_code(401);
        echo json_encode(['error' => '用戶名或密碼錯誤']);
        exit;
    }

    // 驗證成功，重製 Session ID 避免 Session Fixation 攻擊
    session_regenerate_id(true);
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['username'] = $user['username'];

    echo json_encode(['success' => true, 'username' => $user['username']]);
    exit;
}

// 登出
if ($action === 'logout' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $_SESSION = [];
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }
    session_destroy();
    echo json_encode(['success' => true]);
    exit;
}

// 修改密碼
if ($action === 'change_password' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(['error' => '請先登入']);
        exit;
    }

    $currentPassword = $input['current_password'] ?? '';
    $newPassword     = $input['new_password'] ?? '';

    if (empty($currentPassword) || empty($newPassword)) {
        http_response_code(422);
        echo json_encode(['error' => '請填寫目前密碼與新密碼']);
        exit;
    }

    if (strlen($newPassword) < 6) {
        http_response_code(422);
        echo json_encode(['error' => '新密碼長度至少需 6 碼']);
        exit;
    }

    // 取得資料庫中目前的使用者資料與密碼雜湊
    $stmt = $pdo->prepare("SELECT id, password_hash FROM users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($currentPassword, $user['password_hash'])) {
        http_response_code(401);
        echo json_encode(['error' => '目前密碼不正確']);
        exit;
    }

    // 加密新密碼並更新
    $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $updateStmt = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    $updateStmt->execute([$newHash, $_SESSION['user_id']]);

    echo json_encode(['success' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Invalid action']);