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

// 1. 取得某則貼文的留言列表
if ($method === 'GET') {
    $postId = intval($_GET['post_id'] ?? 0);
    if ($postId <= 0) {
        http_response_code(422);
        echo json_encode(['error' => '貼文 ID 無效']);
        exit;
    }

    $stmt = $pdo->prepare("
       SELECT 
    comments.id,
    comments.post_id,
    comments.user_id,
    comments.content,
    comments.created_at,
    users.username,
    users.avatar
FROM comments
JOIN users ON comments.user_id = users.id
WHERE comments.post_id = ?
        ORDER BY comments.created_at ASC
    ");
    $stmt->execute([$postId]);
    $comments = $stmt->fetchAll();

    echo json_encode($comments);
    exit;
}

// 2. 新增留言
if ($method === 'POST') {
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(['error' => '請先登入後再留言']);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    $postId = intval($input['post_id'] ?? 0);
    $content = trim($input['content'] ?? '');

    if ($postId <= 0) {
        http_response_code(422);
        echo json_encode(['error' => '貼文 ID 無效']);
        exit;
    }

    if (empty($content) || mb_strlen($content) > 280) {
        http_response_code(422);
        echo json_encode(['error' => '留言內容需在 1 至 280 字元內']);
        exit;
    }

    // 檢查貼文是否存在
    $postCheck = $pdo->prepare("SELECT id FROM posts WHERE id = ?");
    $postCheck->execute([$postId]);
    if (!$postCheck->fetch()) {
        http_response_code(404);
        echo json_encode(['error' => '該貼文不存在']);
        exit;
    }

    $stmt = $pdo->prepare("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)");
    $stmt->execute([$postId, $_SESSION['user_id'], $content]);
    $newCommentId = $pdo->lastInsertId();

    // 回傳包含用戶名的完整留言物件，方便前端直接 Append
    $commentQuery = $pdo->prepare("
        SELECT 
            comments.id,
            comments.post_id,
            comments.user_id,
            comments.content,
            comments.created_at,
            users.username
        FROM comments
        JOIN users ON comments.user_id = users.id
        WHERE comments.id = ?
    ");
    $commentQuery->execute([$newCommentId]);
    $comment = $commentQuery->fetch();

    echo json_encode([
        'success' => true,
        'comment' => $comment
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method Not Allowed']);