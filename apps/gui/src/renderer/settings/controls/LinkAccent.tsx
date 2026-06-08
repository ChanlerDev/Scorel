import type { ReactNode } from "react";

import { ArrowUpRight } from "../../icons/index.js";

export type LinkAccentProps = {
  children: ReactNode;
  href?: string;
  onClick?(): void;
  trailingArrow?: boolean;
};

export function LinkAccent({ children, href, onClick, trailingArrow }: LinkAccentProps) {
  const props = href
    ? { href, target: "_blank" as const, rel: "noreferrer noopener" }
    : { href: "#", onClick: (event: React.MouseEvent) => { event.preventDefault(); onClick?.(); } };
  return (
    <a className="link-accent" {...props}>
      {children}
      {trailingArrow ? <ArrowUpRight size={12} style={{ marginLeft: 2, verticalAlign: "-1px" }} /> : null}
    </a>
  );
}
