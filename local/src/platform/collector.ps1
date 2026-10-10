# Recolector de procesos para Windows. Vive mientras viva el programa: cada vez
# que por la entrada llega la palabra "scan" responde UNA linea de JSON con los
# procesos de la maquina. No recibe ningun otro dato: nada de lo que llega por
# la red termina en esta consola.
#
# La carpeta de trabajo de un proceso no la da WMI. Se lee del bloque de
# parametros del propio proceso (PEB), que es lo mismo que hace Process
# Explorer. Solo se puede con procesos del mismo usuario: con los del sistema
# OpenProcess falla y la carpeta queda vacia, que es lo que se quiere.
param([switch]$SinCarpeta)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$fuente = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmdCwd {
  [StructLayout(LayoutKind.Sequential)]
  struct PBI { public IntPtr R1; public IntPtr Peb; public IntPtr R2a; public IntPtr R2b; public IntPtr Pid; public IntPtr R3; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI pbi, int len, out int ret);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Get(int pid) {
    if (IntPtr.Size != 8) return null;
    IntPtr h = OpenProcess(0x0410, false, pid); // consultar + leer memoria, nada mas
    if (h == IntPtr.Zero) return null;
    try {
      PBI pbi = new PBI(); int ret; IntPtr n;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
      byte[] p = new byte[8];
      if (!ReadProcessMemory(h, IntPtr.Add(pbi.Peb, 0x20), p, (IntPtr)8, out n)) return null;
      IntPtr pars = (IntPtr)BitConverter.ToInt64(p, 0);
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, IntPtr.Add(pars, 0x38), us, (IntPtr)16, out n)) return null;
      int len = BitConverter.ToUInt16(us, 0);
      if (len <= 0 || len > 4096) return null;
      byte[] s = new byte[len];
      if (!ReadProcessMemory(h, (IntPtr)BitConverter.ToInt64(us, 8), s, (IntPtr)len, out n)) return null;
      return Encoding.Unicode.GetString(s);
    } catch { return null; } finally { CloseHandle(h); }
  }
}
'@
$conCarpeta = $false
if (-not $SinCarpeta) {
  try { Add-Type -TypeDefinition $fuente -ErrorAction Stop; $conCarpeta = $true } catch { $conCarpeta = $false }
}

[Console]::Out.WriteLine('{"ready":true,"cwd":' + $conCarpeta.ToString().ToLower() + '}')

while ($true) {
  $linea = [Console]::In.ReadLine()
  if ($null -eq $linea) { break }   # se cerro el programa: este proceso se va con el
  if ($linea.Trim() -ne 'scan') { continue }

  $lista = New-Object System.Collections.ArrayList
  foreach ($p in (Get-CimInstance Win32_Process)) {
    $cl = $p.CommandLine
    if ($cl -and $cl.Length -gt 1500) { $cl = $cl.Substring(0, 1500) }
    $carpeta = $null
    if ($conCarpeta -and $p.ProcessId -gt 4 -and $p.SessionId -ne 0) { $carpeta = [SmdCwd]::Get([int]$p.ProcessId) }
    $inicio = $null
    if ($p.CreationDate) { $inicio = $p.CreationDate.ToUniversalTime().ToString('o') }
    [void]$lista.Add([ordered]@{
      pid     = [int]$p.ProcessId
      ppid    = [int]$p.ParentProcessId
      name    = $p.Name
      cmd     = $cl
      exe     = $p.ExecutablePath
      cwd     = $carpeta
      start   = $inicio
      mem     = [long]$p.PrivatePageCount
      cpu     = [math]::Round(($p.KernelModeTime + $p.UserModeTime) / 10000000, 2)
      session = [int]$p.SessionId
    })
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ procs = $lista } -Compress -Depth 3))
}
