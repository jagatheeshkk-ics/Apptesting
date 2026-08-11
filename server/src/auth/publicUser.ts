interface UserLike {
  passwordHash: string;
  verificationCodeHash: string | null;
  role?: { allowedPagesJson: string } | null;
}

export function toPublicUser<T extends UserLike>(user: T) {
  const { passwordHash, verificationCodeHash, role, ...rest } = user;
  const publicRole = role
    ? (() => {
        const { allowedPagesJson, ...roleRest } = role;
        return { ...roleRest, allowedPages: JSON.parse(allowedPagesJson) as string[] };
      })()
    : role;
  return { ...rest, role: publicRole };
}
