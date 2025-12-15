"use client"

import Header from '@/components/Header/Header'
import { Button } from '@/components/ui/button'
import AlertError from '@/components/ui/toast/AlertError'
import AlertReward from '@/components/ui/toast/AlertReward'
import AlertSuccess from '@/components/ui/toast/AlertSuccess'
import { toast } from 'sonner'

const page = () => {

    const handleError = () => {
        toast.custom((id) => (
        <AlertError id={id} title='Chat exported successfully!' />
        ), { duration: Infinity } );
    }
    const handleReward = () => {
        toast.custom((id) => (
        <AlertReward id={id} title='Chat exported successfully!' />
        ), { duration: Infinity } );
    }
  return (
    <div>
        <Header />
        <div className='flex justify-center gap-5 mt-10'>
            <Button onClick={handleError} variant="outline">Error Alert</Button>
            <Button onClick={handleReward} variant="outline">Reward Alert</Button>
        </div>
    </div>
  )
}

export default page