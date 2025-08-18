-- 修复HTML页面的slug，移除中文字符

-- 备份原始数据
CREATE TABLE IF NOT EXISTS html_pages_slug_backup AS 
SELECT id, slug, publish_url FROM html_pages;

-- 更新现有页面的slug和publish_url
UPDATE html_pages 
SET 
    slug = CONCAT(
        LOWER(
            REGEXP_REPLACE(
                REGEXP_REPLACE(title, '[^a-zA-Z0-9]+', '-'),
                '^-+|-+$', ''
            )
        ),
        '-',
        SUBSTRING(MD5(CONCAT(id, title, created_at)), 1, 6)
    ),
    publish_url = CONCAT(
        '/pages/',
        user_id,
        '/',
        CONCAT(
            LOWER(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(title, '[^a-zA-Z0-9]+', '-'),
                    '^-+|-+$', ''
                )
            ),
            '-',
            SUBSTRING(MD5(CONCAT(id, title, created_at)), 1, 6)
        )
    )
WHERE slug REGEXP '[^a-zA-Z0-9-]';

-- 如果title全是中文，使用默认值
UPDATE html_pages 
SET 
    slug = CONCAT('page-', SUBSTRING(MD5(CONCAT(id, title, created_at)), 1, 6)),
    publish_url = CONCAT('/pages/', user_id, '/page-', SUBSTRING(MD5(CONCAT(id, title, created_at)), 1, 6))
WHERE slug = '-' OR slug = '' OR slug IS NULL;

-- 添加索引以提高查询性能
ALTER TABLE html_pages ADD INDEX idx_user_slug (user_id, slug);
