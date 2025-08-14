<?php
/**
 * SSO接口测试脚本 - 立即执行版本
 */

// 配置参数
$sso_url = 'https://ai.xingyuncl.com/api/auth/sso';
$username = 'sso_test_user_' . time(); // 生成唯一用户名
$timestamp = time();
$shared_secret = '92c5a700302fded78bf02328d0cb8013'; // 你的密钥

// 生成签名
$signature = hash('sha256', $username . $timestamp . $shared_secret);

// 准备请求数据
$data = [
    'username' => $username,
    'timestamp' => $timestamp,
    'signature' => $signature
];

echo "\n========== SSO测试开始 ==========\n";
echo "测试URL: $sso_url\n";
echo "用户名: $username\n";
echo "时间戳: $timestamp\n";
echo "签名: $signature\n";
echo "请求数据: " . json_encode($data, JSON_PRETTY_PRINT) . "\n";
echo "================================\n\n";

// 发送请求
$ch = curl_init($sso_url);
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);
curl_close($ch);

echo "HTTP状态码: $http_code\n\n";

if ($curl_error) {
    echo "CURL错误: $curl_error\n";
    exit(1);
}

// 解析响应
$result = json_decode($response, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    echo "响应内容（原始）:\n$response\n";
} else {
    echo "响应内容（格式化）:\n";
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
    
    if (isset($result['success']) && $result['success']) {
        echo "\n✅ SSO测试成功！\n";
        
        if (isset($result['data'])) {
            echo "\n返回数据:\n";
            echo "- 用户ID: " . ($result['data']['userId'] ?? 'N/A') . "\n";
            echo "- 用户名: " . ($result['data']['username'] ?? 'N/A') . "\n";
            echo "- Email: " . ($result['data']['email'] ?? 'N/A') . "\n";
            echo "- 角色: " . ($result['data']['role'] ?? 'N/A') . "\n";
            echo "- 组ID: " . ($result['data']['groupId'] ?? 'N/A') . "\n";
            echo "- 积分: " . ($result['data']['credits'] ?? 'N/A') . "\n";
            
            if (isset($result['data']['redirectUrl'])) {
                echo "\n🔗 登录链接（在浏览器中打开）:\n";
                echo $result['data']['redirectUrl'] . "\n";
                echo "\n这个链接包含了认证令牌，打开后会自动登录到系统。\n";
            }
        }
    } else {
        echo "\n❌ SSO测试失败\n";
        echo "错误信息: " . ($result['message'] ?? '未知错误') . "\n";
        
        // 常见错误提示
        if (strpos($result['message'] ?? '', 'signature') !== false) {
            echo "\n可能的原因:\n";
            echo "1. 密钥不正确\n";
            echo "2. 签名计算方式有误\n";
            echo "3. 时间戳过期（默认5分钟有效）\n";
        }
    }
}

echo "\n========== 测试结束 ==========\n";
