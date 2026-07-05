"use client";

import { useEffect, useState } from "react";
import { Mail, Github, MessageCircle, Globe, Copy, Check } from "lucide-react";

interface AuthorContact {
  configured: boolean;
  name?: string | null;
  email?: string | null;
  github?: string | null;
  wechat?: string | null;
  website?: string | null;
  note?: string | null;
}

export default function AuthorContactFooter() {
  const [contact, setContact] = useState<AuthorContact | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/contact")
      .then((r) => r.json())
      .then((data: AuthorContact) => setContact(data))
      .catch(() => setContact(null));
  }, []);

  if (!contact || !contact.configured) {
    // No contact configured via env vars — render nothing rather than an empty box.
    return null;
  }

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <footer className="mt-16 border-t border-border pt-6 pb-4">
      <div className="max-w-3xl mx-auto text-center">
        <h3 className="text-sm font-medium text-foreground mb-3">
          📬 联系作者{contact.name ? ` · ${contact.name}` : ""}
        </h3>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary transition-colors"
              title="发送邮件"
            >
              <Mail className="w-4 h-4" /> 邮箱
            </a>
          )}
          {contact.github && (
            <a
              href={contact.github}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary transition-colors"
              title="GitHub Issues"
            >
              <Github className="w-4 h-4" /> GitHub
            </a>
          )}
          {contact.wechat && (
            <button
              onClick={() => copy("wechat", contact.wechat!)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary transition-colors"
              title={`微信号：${contact.wechat}（点击复制）`}
            >
              <MessageCircle className="w-4 h-4" />
              {copied === "wechat" ? <><Check className="w-3 h-3" /> 已复制</> : "微信"}
            </button>
          )}
          {contact.website && (
            <a
              href={contact.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary transition-colors"
              title="个人网站"
            >
              <Globe className="w-4 h-4" /> 网站
            </a>
          )}
        </div>
        {contact.note && (
          <p className="text-xs text-muted-foreground/70 mt-3">{contact.note}</p>
        )}
      </div>
    </footer>
  );
}
