using SharpLab.Runtime;

[JitGeneric(typeof(int))]
[JitGeneric(typeof(decimal))]
[JitGeneric(typeof(string))]
static class C<T> {
    static T M() {
        return default(T);
    }
}

/* asm

; Core CLR <IGNORE> on amd64

C`1[[System.Int32, System.Private.CoreLib]].M()
    L0000: xor eax, eax
    L0002: ret

C`1[[System.Decimal, System.Private.CoreLib]].M()
    L0000: xor eax, eax
    L0002: mov [rcx], eax
    L0004: mov [rcx+4], eax
    L0007: mov [rcx+8], rax
    L000b: mov rax, rcx
    L000e: ret

C`1[[System.__Canon, System.Private.CoreLib]].M()
    L0000: xor eax, eax
    L0002: ret

*/