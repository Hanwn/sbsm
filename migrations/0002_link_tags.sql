ALTER TABLE vpn_links ADD COLUMN tag TEXT;
ALTER TABLE vpn_groups ADD COLUMN tag TEXT;

CREATE INDEX IF NOT EXISTS idx_vpn_links_tag ON vpn_links(tag);
CREATE INDEX IF NOT EXISTS idx_vpn_groups_tag ON vpn_groups(type, tag);

CREATE TABLE IF NOT EXISTS vpn_group_tags (
  group_id TEXT NOT NULL REFERENCES vpn_groups(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (group_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_vpn_group_tags_tag ON vpn_group_tags(tag);

CREATE TABLE IF NOT EXISTS sb_config_link_tags (
  config_id TEXT NOT NULL REFERENCES sb_configs(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (config_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_sb_config_link_tags_tag ON sb_config_link_tags(tag);
