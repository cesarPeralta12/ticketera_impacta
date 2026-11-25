/** «047F8C520F7A80» → «04:7F:8C:52:0F:7A:80», como lo muestran las apps de NFC. */
export const formatUid = (uid: string) => uid.match(/../g)?.join(":") ?? uid;
