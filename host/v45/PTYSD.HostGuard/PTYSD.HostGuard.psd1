@{
  RootModule='PTYSD.HostGuard.psm1'
  ModuleVersion='0.1.0'
  GUID='47d70842-5fb8-4b59-a649-c187ae04cc1a'
  Author='PTYSD Governance'
  CompanyName='PTYSD'
  Copyright='(c) PTYSD Governance'
  Description='VNEXT4.5 least-privilege HostGuard for one fixed Hyper-V worker VM.'
  PowerShellVersion='5.1'
  RequiredModules=@('Hyper-V')
  FunctionsToExport=@('Get-PTYSDHostGuardStatus','Invoke-PTYSDHostPrepare','Start-PTYSDWorkerVm')
  CmdletsToExport=@()
  VariablesToExport=@()
  AliasesToExport=@()
}
