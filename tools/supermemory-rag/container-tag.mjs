const CONTAINER_TAG_PATTERN = /^[a-zA-Z0-9_:-]+$/;
const MAX_CONTAINER_TAG_LENGTH = 100;

export function assertContainerTag(value, label = "containerTag") {
  const containerTag = String(value ?? "");
  if (
    !containerTag ||
    containerTag.length > MAX_CONTAINER_TAG_LENGTH ||
    !CONTAINER_TAG_PATTERN.test(containerTag)
  ) {
    throw new Error(
      `${label} must match ^[a-zA-Z0-9_:-]+$ and be at most 100 characters`,
    );
  }

  return containerTag;
}
