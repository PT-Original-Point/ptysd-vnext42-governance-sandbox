using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Ptysd.AutonomySupervisor
{
    public sealed class CaptureResult
    {
        public long BytesRead { get; set; }
        public long BytesStored { get; set; }
        public bool Truncated { get; set; }
        public bool MarkerFound { get; set; }
    }

    public static class BoundedPipeCapture
    {
        public static Task<CaptureResult> DrainAsync(Stream input, string path, long byteLimit, string markerPattern)
        {
            if (input == null) throw new ArgumentNullException("input");
            if (String.IsNullOrWhiteSpace(path)) throw new ArgumentException("path");
            if (byteLimit < 0) throw new ArgumentOutOfRangeException("byteLimit");

            return Task.Run(async delegate
            {
                byte[] buffer = new byte[8192];
                long bytesRead = 0;
                long bytesStored = 0;
                bool markerFound = false;
                string tail = String.Empty;

                using (FileStream output = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read))
                {
                    int count;
                    while ((count = await input.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0)
                    {
                        string chunk = Encoding.UTF8.GetString(buffer, 0, count);
                        string scan = tail + chunk;
                        if (!markerFound && !String.IsNullOrEmpty(markerPattern))
                            markerFound = Regex.IsMatch(scan, markerPattern, RegexOptions.CultureInvariant);

                        tail = scan.Length > 256 ? scan.Substring(scan.Length - 256) : scan;
                        bytesRead += count;

                        long remaining = byteLimit - bytesStored;
                        int keep = (int)Math.Max(0L, Math.Min((long)count, remaining));
                        if (keep > 0)
                        {
                            await output.WriteAsync(buffer, 0, keep).ConfigureAwait(false);
                            bytesStored += keep;
                        }
                    }
                    await output.FlushAsync().ConfigureAwait(false);
                }

                return new CaptureResult
                {
                    BytesRead = bytesRead,
                    BytesStored = bytesStored,
                    Truncated = bytesRead > bytesStored,
                    MarkerFound = markerFound
                };
            });
        }
    }

    public sealed class KillOnCloseProcessJob : IDisposable
    {
        private const uint JobObjectLimitKillOnJobClose = 0x2000;
        private const int JobObjectBasicAccountingInformationClass = 1;
        private const int JobObjectExtendedLimitInformationClass = 9;
        private IntPtr handle;

        private KillOnCloseProcessJob(IntPtr value)
        {
            handle = value;
        }

        public static KillOnCloseProcessJob Assign(Process process)
        {
            if (process == null) throw new ArgumentNullException("process");
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                JobObjectExtendedLimitInformation limits = new JobObjectExtendedLimitInformation();
                limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
                int size = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(limits, buffer, false);
                    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, buffer, (uint)size))
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                finally { Marshal.FreeHGlobal(buffer); }

                if (!AssignProcessToJobObject(job, process.Handle))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return new KillOnCloseProcessJob(job);
            }
            catch
            {
                CloseHandle(job);
                throw;
            }
        }

        public int ActiveProcessCount
        {
            get
            {
                if (handle == IntPtr.Zero) throw new ObjectDisposedException("KillOnCloseProcessJob");
                JobObjectBasicAccountingInformation accounting = new JobObjectBasicAccountingInformation();
                uint returned;
                uint size = (uint)Marshal.SizeOf(typeof(JobObjectBasicAccountingInformation));
                if (!QueryInformationJobObject(handle, JobObjectBasicAccountingInformationClass, ref accounting, size, out returned))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return checked((int)accounting.ActiveProcesses);
            }
        }

        public void Terminate(uint exitCode)
        {
            if (handle == IntPtr.Zero) throw new ObjectDisposedException("KillOnCloseProcessJob");
            if (!TerminateJobObject(handle, exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        public void Dispose()
        {
            if (handle == IntPtr.Zero) return;
            IntPtr value = handle;
            handle = IntPtr.Zero;
            if (!CloseHandle(value)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectBasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectExtendedLimitInformation
        {
            public JobObjectBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectBasicAccountingInformation
        {
            public long TotalUserTime;
            public long TotalKernelTime;
            public long ThisPeriodTotalUserTime;
            public long ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount;
            public uint TotalProcesses;
            public uint ActiveProcesses;
            public uint TotalTerminatedProcesses;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, ref JobObjectBasicAccountingInformation info, uint length, out uint returnedLength);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);
    }
}
