#!/usr/bin/env python3
"""迁移脚本：给 phone_numbers 表添加 updated_at 和 recycled_by 列"""
import sys
sys.path.insert(0, '.')

from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    # 检查表结构
    result = conn.execute(text("PRAGMA table_info(phone_numbers)"))
    cols = [row[1] for row in result.fetchall()]
    print('Current columns:', cols)
    
    changes = []
    if 'updated_at' not in cols:
        conn.execute(text('ALTER TABLE phone_numbers ADD COLUMN updated_at TIMESTAMP'))
        changes.append('updated_at')
    if 'recycled_by' not in cols:
        conn.execute(text('ALTER TABLE phone_numbers ADD COLUMN recycled_by INTEGER REFERENCES users(id)'))
        changes.append('recycled_by')
    
    if changes:
        conn.commit()
        print(f'Added columns: {changes}')
    else:
        print('No changes needed')

print('Migration complete!')
