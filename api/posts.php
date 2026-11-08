<?php
session_set_cookie_params([
    'lifetime' => 86400 * 7,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax'
]);
session_start();

require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$currentUserId = $_SESSION['user_id'] ?? 0;

// 1. 貼文互動：按讚與收回讚 (POST ?action=like)
if ($method === 'POST' && $action === 'like') {
    if (!$currentUserId) {
        http_response_code(401);
        echo json_encode(['error' => '請先登入後再按讚']);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $postId = intval($input['post_id'] ?? 0);

    if ($postId <= 0) {
        http_response_code(422);
        echo json_encode(['error' => '貼文 ID 無效']);
        exit;
    }

    // 檢查是否已按過讚
    $checkStmt = $pdo->prepare("SELECT 1 FROM post_likes WHERE user_id = ? AND post_id = ?");
    $checkStmt->execute([$currentUserId, $postId]);
    $exists = $checkStmt->fetch();

    if ($exists) {
        $delStmt = $pdo->prepare("DELETE FROM post_likes WHERE user_id = ? AND post_id = ?");
        $delStmt->execute([$currentUserId, $postId]);
        $likeAction = 'unliked';
    } else {
        $addStmt = $pdo->prepare("INSERT INTO post_likes (user_id, post_id) VALUES (?, ?)");
        $addStmt->execute([$currentUserId, $postId]);
        $likeAction = 'liked';
    }

    $countStmt = $pdo->prepare("SELECT COUNT(DISTINCT user_id) AS likes_count FROM post_likes WHERE post_id = ?");
    $countStmt->execute([$postId]);
    $likesCount = (int)$countStmt->fetchColumn();

    echo json_encode([
        'success'     => true,
        'action'      => $likeAction,
        'likes_count' => $likesCount
    ]);
    exit;
}

// 2. 取得貼文列表 (GET，支援游標分頁與錶款搜尋)
if ($method === 'GET') {
    $beforeId = isset($_GET['before_id']) ? intval($_GET['before_id']) : 0;
    $limit = isset($_GET['limit']) ? min(intval($_GET['limit']), 50) : 10;
    if ($limit <= 0) $limit = 10;

    $queryText = trim($_GET['query'] ?? '');

    $params = [$currentUserId];
    $conditions = [];

    // 分頁游標條件
    if ($beforeId > 0) {
        $conditions[] = "posts.id < ?";
        $params[] = $beforeId;
    }

    // 錶款/關鍵字過濾條件
    if (!empty($queryText)) {
        $conditions[] = "posts.content LIKE ?";
        $params[] = '%' . $queryText . '%';
    }

    $whereClause = "";
    if (!empty($conditions)) {
        $whereClause = "WHERE " . implode(" AND ", $conditions);
    }

    $sql = "
        SELECT 
            posts.id, 
            posts.user_id,
            posts.content, 
            posts.created_at, 
            posts.updated_at,
            users.username,
            users.avatar,
            COUNT(DISTINCT post_likes.user_id) AS likes_count,
            COUNT(DISTINCT comments.id) AS comments_count,
            MAX(CASE WHEN post_likes.user_id = ? THEN 1 ELSE 0 END) AS liked_by_me
        FROM posts
        JOIN users ON posts.user_id = users.id
        LEFT JOIN post_likes ON posts.id = post_likes.post_id
        LEFT JOIN comments ON posts.id = comments.post_id
        $whereClause
        GROUP BY posts.id
        ORDER BY posts.id DESC
        LIMIT " . intval($limit);

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $posts = $stmt->fetchAll();

    echo json_encode([
        'posts'       => $posts,
        'has_more'    => count($posts) === $limit,
        'next_cursor' => !empty($posts) ? end($posts)['id'] : null
    ]);
    exit;
}

// 3. 發佈新貼文 (POST)
if ($method === 'POST') {
    if (!$currentUserId) {
        http_response_code(401);
        echo json_encode(['error' => '請先登入後再發佈貼文']);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $content = trim($input['content'] ?? '');

    if (empty($content) || mb_strlen($content) > 280) {
        http_response_code(422);
        echo json_encode(['error' => '貼文長度需在 1 至 280 字元內']);
        exit;
    }

    $stmt = $pdo->prepare("INSERT INTO posts (user_id, content) VALUES (?, ?)");
    $stmt->execute([$currentUserId, $content]);
    $newPostId = $pdo->lastInsertId();

    $query = $pdo->prepare("
        SELECT 
            posts.id, 
            posts.user_id, 
            posts.content, 
            posts.created_at, 
            posts.updated_at,
            users.username,
            users.avatar,
            0 AS likes_count,
            0 AS comments_count,
            0 AS liked_by_me
        FROM posts
        JOIN users ON posts.user_id = users.id
        WHERE posts.id = ?
    ");
    $query->execute([$newPostId]);
    $newPost = $query->fetch();

    echo json_encode([
        'success' => true,
        'post'    => $newPost
    ]);
    exit;
}

// 4. 編輯貼文內容 (PUT ?id={id})
if ($method === 'PUT') {
    if (!$currentUserId) {
        http_response_code(401);
        echo json_encode(['error' => '請先登入']);
        exit;
    }

    $postId = intval($_GET['id'] ?? 0);
    if ($postId <= 0) {
        http_response_code(422);
        echo json_encode(['error' => '貼文 ID 無效']);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $content = trim($input['content'] ?? '');

    if (empty($content) || mb_strlen($content) > 280) {
        http_response_code(422);
        echo json_encode(['error' => '貼文長度需在 1 至 280 字元內']);
        exit;
    }

    $checkStmt = $pdo->prepare("SELECT user_id FROM posts WHERE id = ?");
    $checkStmt->execute([$postId]);
    $post = $checkStmt->fetch();

    if (!$post) {
        http_response_code(404);
        echo json_encode(['error' => '找不到該篇貼文']);
        exit;
    }

    if ((int)$post['user_id'] !== (int)$currentUserId) {
        http_response_code(403);
        echo json_encode(['error' => '無權限修改此貼文']);
        exit;
    }

    $updateStmt = $pdo->prepare("UPDATE posts SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    $updateStmt->execute([$content, $postId]);

    echo json_encode(['success' => true]);
    exit;
}

// 5. 刪除貼文 (DELETE ?id={id})
if ($method === 'DELETE') {
    if (!$currentUserId) {
        http_response_code(401);
        echo json_encode(['error' => '請先登入']);
        exit;
    }

    $postId = intval($_GET['id'] ?? 0);
    if ($postId <= 0) {
        http_response_code(422);
        echo json_encode(['error' => '貼文 ID 無效']);
        exit;
    }

    $checkStmt = $pdo->prepare("SELECT user_id FROM posts WHERE id = ?");
    $checkStmt->execute([$postId]);
    $post = $checkStmt->fetch();

    if (!$post) {
        http_response_code(404);
        echo json_encode(['error' => '找不到該篇貼文']);
        exit;
    }

    if ((int)$post['user_id'] !== (int)$currentUserId) {
        http_response_code(403);
        echo json_encode(['error' => '無權限刪除此貼文']);
        exit;
    }

    $delStmt = $pdo->prepare("DELETE FROM posts WHERE id = ?");
    $delStmt->execute([$postId]);

    echo json_encode(['success' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method Not Allowed']);